import hashlib
import os
import socket
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

import main


class NotificationConfigurationTests(unittest.TestCase):
    def test_smtp_configuration_requires_a_sender_and_matching_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(main._smtp_configuration())

        with patch.dict(os.environ, {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_FROM_EMAIL": "signals@example.com",
            "SMTP_USERNAME": "signals@example.com",
        }, clear=True):
            self.assertIsNone(main._smtp_configuration())

        with patch.dict(os.environ, {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_FROM_EMAIL": "signals@example.com",
            "SMTP_USERNAME": "signals@example.com",
            "SMTP_PASSWORD": "app-password",
            "SMTP_PORT": "587",
        }, clear=True):
            self.assertEqual(main._smtp_configuration()["port"], 587)

    def test_push_endpoint_requires_public_https(self):
        with self.assertRaises(ValueError):
            main._validate_push_endpoint("http://push.example.com/")
        with self.assertRaises(ValueError):
            main._validate_push_endpoint("https://push.example.com:invalid/")

        private_address = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch("main.socket.getaddrinfo", return_value=private_address):
            with self.assertRaises(ValueError):
                main._validate_push_endpoint("https://push.example.com/")

        public_address = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch("main.socket.getaddrinfo", return_value=public_address):
            main._validate_push_endpoint("https://push.example.com/")

    def test_notification_targets_only_include_approved_users_and_valid_emails(self):
        users = {
            "approved": {
                "status": "approved",
                "email": "approved@example.com",
                "pushSubscriptions": {"browser-a": {"endpoint": "https://push.example.com/"}},
            },
            "pending": {"status": "pending", "email": "pending@example.com"},
            "invalid-email": {"status": "approved", "email": "not-an-email"},
        }
        with patch("main.firebase_db.reference") as reference:
            reference.return_value.get.return_value = users
            email_targets, push_targets = main._notification_targets(object())

        self.assertEqual(email_targets, ["approved"])
        self.assertEqual(push_targets, {"approved": ["browser-a"]})

    def test_dispatch_is_pending_only_while_a_recipient_is_unsent(self):
        self.assertTrue(main._has_pending_notification({
            "emailRecipients": ["member"],
            "emailSent": {},
            "pushRecipients": {"member": ["browser"]},
            "pushSent": {"member": {}},
        }))
        self.assertFalse(main._has_pending_notification({
            "emailRecipients": ["member"],
            "emailSent": {"member": True},
            "pushRecipients": {"member": ["browser"]},
            "pushSent": {"member": {"browser": True}},
        }))
        self.assertFalse(main._has_pending_notification({
            "emailRecipients": [],
            "emailSent": {},
            "pushRecipients": {},
            "pushSent": {},
        }))

    def test_push_only_dispatch_does_not_queue_email_retries(self):
        with patch(
            "main._notification_targets",
            return_value=(["member"], {"member": ["browser"]}),
        ), patch("main._smtp_configuration", return_value=None):
            dispatch = main._new_notification_dispatch(object(), 123)

        self.assertEqual(dispatch["emailRecipients"], [])
        self.assertEqual(dispatch["pushRecipients"], {"member": ["browser"]})


class SignalNotificationDeliveryTests(unittest.TestCase):
    signal = {
        "direction": "buy",
        "entry_time": 1704133800,
        "entry": 2000.0,
        "stop": 1995.0,
        "setup": "M5 Sweep + BOS",
    }

    def test_smtp_email_contains_signal_details_and_colombo_time(self):
        smtp_context = MagicMock()
        smtp = smtp_context.__enter__.return_value
        environment = {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "signals@example.com",
            "SMTP_PASSWORD": "app-password",
            "SMTP_FROM_EMAIL": "signals@example.com",
        }
        with patch.dict(os.environ, environment, clear=True), patch(
            "main.smtplib.SMTP", return_value=smtp_context
        ):
            main._send_signal_email("user@example.com", "GOLD", self.signal)

        message = smtp_context.send_message.call_args.args[0]
        self.assertEqual(message["To"], "user@example.com")
        self.assertIn("BUY signal", message["Subject"])
        self.assertIn("Time (Sri Lanka): 2024-01-02 00:00", message.get_content())
        self.assertIn("Entry: 2000.00", message.get_content())
        smtp_context.starttls.assert_called_once()

    def test_dispatch_sends_to_queued_approved_email_and_push_targets_once(self):
        profiles = {
            "users": {
                "member": {
                    "status": "approved",
                    "email": "member@example.com",
                    "pushSubscriptions": {
                        "browser": {
                            "endpoint": "https://push.example.com/",
                            "keys": {"p256dh": "key", "auth": "secret"},
                        }
                    },
                }
            },
            "users/member/pushSubscriptions/browser": {
                "endpoint": "https://push.example.com/",
                "keys": {"p256dh": "key", "auth": "secret"},
            },
        }

        def reference(path, app=None):
            entry = MagicMock()
            entry.get.return_value = profiles.get(path)
            return entry

        dispatch = {
            "emailRecipients": ["member"],
            "emailSent": {},
            "pushRecipients": {"member": ["browser"]},
            "pushSent": {},
        }
        with patch("main.firebase_db.reference", side_effect=reference), patch(
            "main._smtp_configuration", return_value={"host": "smtp.example.com"}
        ), patch("main._send_signal_email") as send_email, patch(
            "main._web_push_configuration_available", return_value=True
        ), patch("main._send_web_push") as send_push:
            results = main._dispatch_signal_notifications(
                object(), "GOLD", "GOLD", "1704133800_buy", self.signal, dispatch
            )

        self.assertEqual(results, {
            "email_sent": 1,
            "email_failed": 0,
            "push_sent": 1,
            "push_failed": 0,
        })
        send_email.assert_called_once_with("member@example.com", "GOLD", self.signal)
        send_push.assert_called_once_with(
            profiles["users/member/pushSubscriptions/browser"], "GOLD", self.signal
        )


class PushSubscriptionEndpointTests(unittest.TestCase):
    payload = main.PushSubscriptionRequest(
        endpoint="https://push.example.com/subscription",
        keys={"p256dh": "public-key", "auth": "auth-secret"},
    )

    def test_subscription_is_saved_under_the_authenticated_user(self):
        subscription_ref = MagicMock()
        subscription_ref.get.return_value = None
        subscriptions_ref = MagicMock()
        subscriptions_ref.get.return_value = {}

        def reference(path, app=None):
            return {
                "users/member/pushSubscriptions/"
                + hashlib.sha256(self.payload.endpoint.encode()).hexdigest(): subscription_ref,
                "users/member/pushSubscriptions": subscriptions_ref,
            }[path]

        with patch("main.require_notification_access", return_value="member"), patch(
            "main._validate_push_endpoint"
        ), patch("main.get_signals_firebase_app", return_value=object()), patch(
            "main.firebase_db.reference", side_effect=reference
        ):
            result = main.save_push_subscription(self.payload, object())

        self.assertEqual(result, {"enabled": True})
        self.assertEqual(subscription_ref.set.call_args.args[0]["keys"]["p256dh"], "public-key")

    def test_subscription_limit_is_enforced(self):
        subscription_ref = MagicMock()
        subscription_ref.get.return_value = None
        subscriptions_ref = MagicMock()
        subscriptions_ref.get.return_value = {f"device-{index}": {} for index in range(10)}

        def reference(path, app=None):
            return subscription_ref if path.endswith(hashlib.sha256(self.payload.endpoint.encode()).hexdigest()) else subscriptions_ref

        with patch("main.require_notification_access", return_value="member"), patch(
            "main._validate_push_endpoint"
        ), patch("main.get_signals_firebase_app", return_value=object()), patch(
            "main.firebase_db.reference", side_effect=reference
        ):
            with self.assertRaises(HTTPException) as error:
                main.save_push_subscription(self.payload, object())

        self.assertEqual(error.exception.status_code, 409)

    def test_subscription_status_is_scoped_to_the_authenticated_user(self):
        subscriptions_ref = MagicMock()
        subscriptions_ref.get.return_value = {"browser-id": {"endpoint": "secret"}}
        with patch("main.require_notification_access", return_value="member"), patch(
            "main.get_signals_firebase_app", return_value=object()
        ), patch("main.firebase_db.reference", return_value=subscriptions_ref) as reference:
            result = main.get_push_subscriptions(object())

        self.assertEqual(result, {"subscription_ids": ["browser-id"]})
        self.assertEqual(reference.call_args.args[0], "users/member/pushSubscriptions")


class SignalPublishNotificationTests(unittest.TestCase):
    def test_new_signal_queues_notification_only_once(self):
        timestamp = int(main.dt.datetime.now(main.dt.timezone.utc).timestamp())
        signal = {
            "direction": "buy",
            "entry_time": timestamp,
            "entry": 2000.0,
            "stop": 1995.0,
        }
        signal_id = f"{timestamp}_buy"
        signal_ref = MagicMock()
        signal_ref.get.side_effect = [{}, {signal_id: signal}]
        dispatch_entry = MagicMock()
        dispatch_entry.get.side_effect = [
            {"emailRecipients": ["member"], "emailSent": {}, "pushRecipients": {}, "pushSent": {}},
            {"emailRecipients": ["member"], "emailSent": {"member": True}, "pushRecipients": {}, "pushSent": {}},
        ]
        dispatch_root = MagicMock()
        dispatch_root.child.return_value = dispatch_entry
        references = {
            "signals/GOLD": signal_ref,
            "notificationDispatch/GOLD": dispatch_root,
        }
        payload = main.SignalPublishRequest(symbol="GOLD", signals=[signal])

        with patch("main.get_signals_firebase_app", return_value=object()), patch(
            "main.firebase_db.reference", side_effect=lambda path, app=None: references[path]
        ), patch("main._new_notification_dispatch", return_value={
            "emailRecipients": ["member"],
            "emailSent": {},
            "pushRecipients": {},
            "pushSent": {},
        }), patch("main._dispatch_signal_notifications", return_value={
            "email_sent": 1,
            "email_failed": 0,
            "push_sent": 0,
            "push_failed": 0,
        }) as dispatch:
            first = main.publish_signals(payload, None)
            second = main.publish_signals(payload, None)

        self.assertEqual(first["new_signals"], 1)
        self.assertEqual(second["new_signals"], 0)
        dispatch.assert_called_once()


if __name__ == "__main__":
    unittest.main()

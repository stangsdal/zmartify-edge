from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.email_settings import EmailSettingsError, smtp_configuration


class EmailDeliveryError(RuntimeError):
    pass


def _send_email(*, recipient: str, subject: str, content: str) -> None:
    try:
        settings = smtp_configuration()
    except EmailSettingsError as exc:
        raise EmailDeliveryError(str(exc)) from exc
    host = settings["host"]
    username = settings["username"]
    password = settings["password"]
    sender = settings["sender"]
    port = settings["port"]
    if not all((host, username, password, sender)):
        raise EmailDeliveryError("outbound email is not configured")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(content)
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as client:
                client.login(username, password)
                client.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.starttls()
                client.login(username, password)
                client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError("could not send email") from exc


def send_site_invitation(*, recipient: str, site_name: str, role: str, invitation_url: str) -> None:
    _send_email(
        recipient=recipient,
        subject=f"Invitation to {site_name}",
        content=(
            f"You have been invited to {site_name} as a {role}.\n\n"
            f"Accept the invitation by opening this link:\n{invitation_url}\n"
        ),
    )


def send_smtp_test_email(*, recipient: str) -> None:
    _send_email(
        recipient=recipient,
        subject="Zmartify SMTP test",
        content="This is a test email from Zmartify. Your SMTP settings are working.\n",
    )
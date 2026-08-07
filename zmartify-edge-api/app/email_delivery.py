from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.email_settings import EmailSettingsError, smtp_configuration


class EmailDeliveryError(RuntimeError):
    pass


def send_site_invitation(*, recipient: str, site_name: str, role: str, invitation_url: str) -> None:
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
    message["Subject"] = f"Invitation to {site_name}"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"You have been invited to {site_name} as a {role}.\n\n"
        f"Accept the invitation by opening this link:\n{invitation_url}\n"
    )
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
        raise EmailDeliveryError("could not send invitation email") from exc
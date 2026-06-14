#!/bin/sh
set -e

# Prevent mosquitto service from auto-starting during apt install
# (the API container only needs the mosquitto_passwd binary, not the broker)
echo '#!/bin/sh
exit 101' > /usr/sbin/policy-rc.d
chmod +x /usr/sbin/policy-rc.d

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mosquitto docker-cli

# Remove policy override so normal subsequent installs aren't affected
rm -f /usr/sbin/policy-rc.d

pip install -q -r requirements.txt
exec uvicorn main:app --host 0.0.0.0 --port 8080

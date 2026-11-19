#!/usr/bin/env bash
# 漫画日语课 — adds HTTPS for japanese.fttool.cn. Run after setup.sh. Safe to run again.
# What it does:
#   1. gets a Let's Encrypt certificate for the domain (uses the certbot or acme.sh already on the
#      server; installs certbot only if neither is found)
#   2. adds a :443 virtual host to etc/extra/japanese-site.conf
# It keeps a copy of japanese-site.conf and puts it back if the config test fails or the other
# sites answer differently afterwards.
set -u
DOMAIN="japanese.fttool.cn"
SITE_DIR="/opt/japanese-site"
WEBROOT="$SITE_DIR/public"
LAMPP="/opt/lampp"
CTL="$LAMPP/bin/apachectl"
OURS="$LAMPP/etc/extra/japanese-site.conf"
RELOAD="$LAMPP/lampp reloadapache"
say() { echo "[https] $*"; }
fail() { echo "[https] FAILED: $*"; exit 1; }
probe() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
sum() { curl -s -m 10 "$@" 2>/dev/null | md5sum | cut -d' ' -f1; }

[ "$(id -u)" = "0" ] || fail "run with sudo"
[ -f "$OURS" ] && [ -f "$WEBROOT/index.html" ] || fail "run setup.sh first"
HTTP_CODE="$(probe -H "Host: $DOMAIN" http://127.0.0.1/lessons/index.json)"
[ "$HTTP_CODE" = "200" ] || fail "the http site is not answering (HTTP $HTTP_CODE), so a certificate cannot be issued"

VHOSTS="$("$CTL" -S -DSSL -DPHP 2>&1)"
ADDR443="$(echo "$VHOSTS" | grep -v -F "$OURS" | sed -n 's/^\([^ ]*\):443[[:space:]].*/\1/p' | head -1)"
[ -n "$ADDR443" ] || ADDR443="*"

# ---- 1. certificate ----
find_certbot() {
  command -v certbot 2>/dev/null && return
  for p in /usr/local/bin/certbot /snap/bin/certbot /opt/certbot/bin/certbot; do [ -x "$p" ] && { echo "$p"; return; }; done
}
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
HOW="existing certificate"
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  CB="$(find_certbot)"
  ACME="$(ls /root/.acme.sh/acme.sh /home/*/.acme.sh/acme.sh 2>/dev/null | head -1)"
  if [ -z "$CB" ] && [ -z "$ACME" ]; then
    say "no certbot or acme.sh found; installing certbot"
    (dnf install -y epel-release && dnf install -y certbot) >/tmp/japanese-site-certbot-install.log 2>&1 \
      || (yum install -y epel-release && yum install -y certbot) >>/tmp/japanese-site-certbot-install.log 2>&1
    CB="$(find_certbot)"
  fi
  if [ -n "$CB" ]; then
    HOW="certbot ($CB)"
    "$CB" certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos \
      --register-unsafely-without-email --deploy-hook "$RELOAD" 2>&1 | tail -15
  elif [ -n "$ACME" ]; then
    HOW="acme.sh ($ACME)"
    AHOME="$(dirname "$ACME")"
    mkdir -p /etc/ssl/japanese-site
    CERT="/etc/ssl/japanese-site/fullchain.pem"; KEY="/etc/ssl/japanese-site/privkey.pem"
    "$ACME" --home "$AHOME" --issue -d "$DOMAIN" -w "$WEBROOT" --server letsencrypt 2>&1 | tail -15
    "$ACME" --home "$AHOME" --install-cert -d "$DOMAIN" --key-file "$KEY" --fullchain-file "$CERT" --reloadcmd "$RELOAD" 2>&1 | tail -5
  else
    fail "could not find or install a Let's Encrypt client (see /tmp/japanese-site-certbot-install.log)"
  fi
fi
[ -s "$CERT" ] && [ -s "$KEY" ] || fail "no certificate was issued for $DOMAIN (method: $HOW) — nothing on the server was changed"
say "certificate ready ($HOW)"

# ---- 2. :443 virtual host ----
B80_CODE="$(probe http://127.0.0.1/)";  B80_SUM="$(sum http://127.0.0.1/)";  B80_SUM2="$(sum http://127.0.0.1/)"
B443_CODE="$(probe -k https://127.0.0.1/)"; B443_SUM="$(sum -k https://127.0.0.1/)"; B443_SUM2="$(sum -k https://127.0.0.1/)"
cp -p "$OURS" "$OURS.before-https"
sed -i '/^# >>> https$/,/^# <<< https$/d' "$OURS"
cat >> "$OURS" <<VHOST
# >>> https
<IfModule ssl_module>
<VirtualHost $ADDR443:443>
    ServerName $DOMAIN
    DocumentRoot "$WEBROOT"
    SSLEngine on
    SSLCertificateFile "$CERT"
    SSLCertificateKeyFile "$KEY"
    <Directory "$WEBROOT">
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>
    <IfModule mod_headers.c>
        <FilesMatch "\.(json|html)$">
            Header set Cache-Control "no-cache"
        </FilesMatch>
    </IfModule>
</VirtualHost>
</IfModule>
# <<< https
VHOST

undo() {
  cp -p "$OURS.before-https" "$OURS"
  $RELOAD >/dev/null 2>&1
  fail "$1 — the virtual host file was put back as it was; the certificate stays on the server"
}
"$CTL" -t -DSSL -DPHP >/tmp/japanese-site-configtest.log 2>&1 || { cat /tmp/japanese-site-configtest.log; undo "Apache config test failed"; }
$RELOAD >/dev/null 2>&1 || undo "could not reload Apache"
sleep 3
A80_CODE="$(probe http://127.0.0.1/)";  A80_SUM="$(sum http://127.0.0.1/)"
A443_CODE="$(probe -k https://127.0.0.1/)"; A443_SUM="$(sum -k https://127.0.0.1/)"
CHANGED=no
[ "$B80_CODE" = "$A80_CODE" ] && [ "$B443_CODE" = "$A443_CODE" ] || CHANGED=yes
# compare page content only where the page is static (two reads before the change matched)
[ "$B80_SUM" = "$B80_SUM2" ] && [ "$B80_SUM" != "$A80_SUM" ] && CHANGED=yes
[ "$B443_SUM" = "$B443_SUM2" ] && [ "$B443_SUM" != "$A443_SUM" ] && CHANGED=yes
[ "$CHANGED" = "no" ] || undo "the existing sites answered differently after the change (http $B80_CODE -> $A80_CODE, https $B443_CODE -> $A443_CODE)"

SITE_TLS="$(probe --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/lessons/index.json")"
SITE_ANY="$(probe -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/lessons/index.json")"

echo
echo "======== RESULT ========"
echo "certificate: $HOW"
echo "https virtual host address: $ADDR443:443"
echo "existing sites: http $B80_CODE -> $A80_CODE, https $B443_CODE -> $A443_CODE (unchanged)"
echo "https://$DOMAIN with certificate check: HTTP $SITE_TLS  (200 means it works)"
echo "https://$DOMAIN ignoring certificate:   HTTP $SITE_ANY"
echo "========================"
[ "$SITE_TLS" = "200" ] && say "done — open https://$DOMAIN/" || say "the https site did not answer 200 with a valid certificate; send this output back"

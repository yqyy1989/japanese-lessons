#!/usr/bin/env bash
# 漫画日语课 — one-time server setup for XAMPP (/opt/lampp). Safe to run again.
# What it does:
#   1. clones this repository to /opt/japanese-site
#   2. adds a cron job that pulls new lessons from GitHub every minute
#   3. adds an Apache virtual host so japanese.fttool.cn serves /opt/japanese-site/public
# It backs up httpd.conf first and puts it back if the existing sites change or the config test fails.
set -u
REPO_URL="https://github.com/yqyy1989/japanese-lessons.git"
SITE_DIR="/opt/japanese-site"
DOMAIN="japanese.fttool.cn"
LAMPP="/opt/lampp"
HTTPD="$LAMPP/bin/apachectl"
CONF="$LAMPP/etc/httpd.conf"
OURS="$LAMPP/etc/extra/japanese-site.conf"
say() { echo "[setup] $*"; }
fail() { echo "[setup] FAILED: $*"; exit 1; }

[ "$(id -u)" = "0" ] || fail "run with sudo"
[ -x "$HTTPD" ] && [ -f "$CONF" ] || fail "XAMPP not found at $LAMPP"

# ---- 1. site files ----
if ! command -v git >/dev/null 2>&1; then
  say "installing git"
  (yum install -y git || dnf install -y git) >/dev/null 2>&1 || fail "could not install git"
fi
GIT="$(command -v git)"
if [ -d "$SITE_DIR/.git" ]; then
  "$GIT" -C "$SITE_DIR" fetch -q --depth 1 origin main && "$GIT" -C "$SITE_DIR" reset -q --hard FETCH_HEAD || fail "git update failed"
else
  "$GIT" clone -q --depth 1 --branch main "$REPO_URL" "$SITE_DIR" || fail "git clone failed"
fi
chmod -R a+rX "$SITE_DIR"
[ -f "$SITE_DIR/public/index.html" ] || fail "public/index.html missing after clone"
say "site files ready in $SITE_DIR ($(ls "$SITE_DIR/public/lessons" | wc -l) files in lessons/)"

# ---- 2. pull new lessons every minute ----
cat > /etc/cron.d/japanese-site <<CRON
* * * * * root cd $SITE_DIR && /usr/bin/flock -n /tmp/japanese-site.lock sh -c '$GIT fetch -q --depth 1 origin main && $GIT reset -q --hard FETCH_HEAD && chmod -R a+rX $SITE_DIR' >> /var/log/japanese-site.log 2>&1
CRON
chmod 644 /etc/cron.d/japanese-site
(systemctl enable --now crond >/dev/null 2>&1 || service crond start >/dev/null 2>&1 || true)
say "cron job installed (/etc/cron.d/japanese-site)"

# ---- 3. Apache virtual host ----
probe() { curl -s -m 8 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
sum() { curl -s -m 8 "$@" 2>/dev/null | md5sum | cut -d' ' -f1; }
BEFORE_CODE="$(probe http://127.0.0.1/)"
BEFORE_SUM="$(sum http://127.0.0.1/)"
BEFORE_SUM2="$(sum http://127.0.0.1/)"
VHOSTS="$("$HTTPD" -S -DSSL -DPHP 2>&1)"
MAINROOT="$(echo "$VHOSTS" | sed -n 's/^Main DocumentRoot: "\(.*\)"$/\1/p' | head -1)"
[ -n "$MAINROOT" ] || MAINROOT="$LAMPP/htdocs"
HAS80="$(echo "$VHOSTS" | grep -F '(' | grep -v -F "$OURS" | grep -cE '(^[^ ]*:80[[:space:]])|(port 80 namevhost)')"

BACKUP="$CONF.before-japanese-site"
[ -f "$BACKUP" ] || cp -p "$CONF" "$BACKUP"
{
  echo "# 漫画日语课 — written by server/setup.sh; safe to delete together with its Include line in httpd.conf"
  if [ "$HAS80" = "0" ]; then
    echo "# keeps every other host name on the existing site"
    echo "<VirtualHost *:80>"
    echo "    DocumentRoot \"$MAINROOT\""
    echo "</VirtualHost>"
  fi
  cat <<VHOST
<VirtualHost *:80>
    ServerName $DOMAIN
    DocumentRoot "$SITE_DIR/public"
    <Directory "$SITE_DIR/public">
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
VHOST
} > "$OURS"
grep -q 'etc/extra/japanese-site.conf' "$CONF" || printf '\n# 漫画日语课\nInclude etc/extra/japanese-site.conf\n' >> "$CONF"

undo() {
  cp -p "$BACKUP" "$CONF"; rm -f "$OURS"
  "$LAMPP/lampp" reloadapache >/dev/null 2>&1
  fail "$1 — Apache settings were put back as they were; the site files and cron job stay in place"
}
"$HTTPD" -t -DSSL -DPHP >/tmp/japanese-site-configtest.log 2>&1 || { cat /tmp/japanese-site-configtest.log; undo "Apache config test failed"; }
"$LAMPP/lampp" reloadapache >/dev/null 2>&1 || undo "could not reload Apache"
sleep 2
AFTER_CODE="$(probe http://127.0.0.1/)"
AFTER_SUM="$(sum http://127.0.0.1/)"
SAME_PAGE=yes
# only compare page content when the existing home page is static (two reads before the change matched)
[ "$BEFORE_SUM" = "$BEFORE_SUM2" ] && [ "$BEFORE_SUM" != "$AFTER_SUM" ] && SAME_PAGE=no
if [ "$BEFORE_CODE" != "$AFTER_CODE" ] || [ "$SAME_PAGE" = "no" ]; then
  undo "the existing site answered differently after the change ($BEFORE_CODE -> $AFTER_CODE)"
fi
SITE_CODE="$(probe -H "Host: $DOMAIN" http://127.0.0.1/lessons/index.json)"

echo
echo "======== RESULT ========"
echo "existing site: HTTP $BEFORE_CODE before, HTTP $AFTER_CODE after (unchanged)"
echo "new site ($DOMAIN) on this server: HTTP $SITE_CODE  (200 means it works)"
echo "other :80 virtual hosts found before: $HAS80"
echo "DNS for $DOMAIN: $(getent hosts "$DOMAIN" | awk '{print $1}' | tr '\n' ' ')"
echo "this server's public IP: $(curl -s -m 5 https://api.ipify.org 2>/dev/null)"
echo "OS: $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")   SELinux: $(getenforce 2>/dev/null || echo n/a)"
echo "========================"
[ "$SITE_CODE" = "200" ] && say "done — open http://$DOMAIN/" || say "the virtual host is in place but did not answer 200; send this output back"

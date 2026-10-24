#!/bin/sh
set -eu
case "$REDIS_PASSWORD" in *[!a-zA-Z0-9_-]*|'') echo 'Use a nonempty base64url Redis password' >&2; exit 1;; esac
umask 077
printf 'user default off\nuser sensorguard on >%s ~* &* +@all -@admin -flushall -flushdb\n' "$REDIS_PASSWORD" > /tmp/users.acl
exec redis-server --aclfile /tmp/users.acl --appendonly yes --appendfsync everysec --maxmemory 384mb --maxmemory-policy noeviction

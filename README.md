# qWDTT OpenWrt

RAW-IP клиент qWDTT для роутеров OpenWrt. Он поднимает интерфейс `qwdtt0` и
направляет через туннель IPv4-трафик устройств локальной сети. Сам роутер
сохраняет прямой доступ к WAN, поэтому соединения с VK TURN не зацикливаются.

Поддерживается только RAW-IP. WireGuard и SOCKS в этой сборке намеренно не
включены.

## Что понадобится

- Роутер с OpenWrt 25.12+ или совместимой версией с `procd` и `firewall4`.
- Пакеты `ip-full`, `kmod-tun`, `ca-bundle`.
- Сервер qWDTT с включённым RAW-слушателем. Обычно это UDP-порт `56003`.
- Данные подключения: адрес сервера, пароль и хеш звонка VK.

## Быстрый запуск

1. Откройте [Releases](../../releases/latest) и скачайте архив для архитектуры
   своего роутера. Сборки во вкладке [Actions](../../actions/workflows/build.yml)
   нужны только для тестирования новых изменений до выпуска релиза.
2. Распакуйте архив на роутере и запустите установку от `root`:

   ```sh
   tar -xzf qwdtt-openwrt-aarch64.tar.gz
   cd qwdtt-openwrt-aarch64
   ./install.sh
   ```

3. Если установщик попросил зависимости, установите их и запустите его ещё раз:

   ```sh
   apk update && apk add ip-full kmod-tun ca-bundle
   ```

   На старых версиях OpenWrt вместо этого:

   ```sh
   opkg update && opkg install ip-full kmod-tun ca-bundle
   ```

4. Откройте `/etc/qwdtt/config.json` и заполните `peer`, `hashes` и `password`.
   Пароль и хеш нельзя публиковать или отправлять посторонним.
5. Включите сервис:

   ```sh
   uci set qwdtt.main.enabled='1'
   uci commit qwdtt
   /etc/init.d/qwdtt start
   ```

## Проверка

Логи подключения:

```sh
logread -e qwdtt
```

Рабочее подключение пишет `RAW-конфиг получен`, затем `TUN подключён, трафик
пошёл`. Проверить интерфейс и правило маршрутизации можно так:

```sh
ip addr show qwdtt0
ip rule show
ip route show table 51820
```

Проверка создания TUN без данных VK и сервера:

```sh
/usr/bin/qwdtt-client -rawtun-self-test 10.70.0.2
```

## Настройка

Пример файла находится в [`files/etc/qwdtt/config.json`](files/etc/qwdtt/config.json).

`lan_interface` по умолчанию — `br-lan`. Если в вашей сборке OpenWrt LAN
называется иначе, поменяйте это поле. При изменении `tun_name` нужно также
изменить устройство зоны `qwdtt` в конфигурации firewall.

Остановить клиент:

```sh
/etc/init.d/qwdtt stop
```

## Архитектуры сборок

| Артефакт | Для чего |
| --- | --- |
| `x86_64` | x86-роутеры и виртуальные машины |
| `aarch64` | современные ARM64-роутеры |
| `armv7` | 32-битные ARMv7-устройства |
| `mipsel` | старые MIPS little-endian роутеры |

Перед скачиванием можно проверить архитектуру командой `uname -m`.

## Веб-интерфейс (LuCI)

В этом репозитории также есть пакет `luci-app-qwdtt` — русскоязычный
интерфейс LuCI для управления клиентом: состояние и управление службой,
настройки подключения и диагностика.

Пакет выпускается в виде готового `.ipk` в разделе
[Releases](../../releases/latest) (артефакт
`luci-app-qwdtt_1.0.0-1_all.ipk`). Установите его после клиента:

```sh
opkg install luci-app-qwdtt_1.0.0-1_all.ipk
```

На OpenWrt с `apk`:

```sh
apk add --allow-untrusted luci-app-qwdtt_1.0.0-1_all.ipk
```

После установки раздел **qWDTT** появится в LuCI в меню *Службы*
(Обзор / Настройки / Диагностика). Для полного доступа вернитесь на страницу
входа в LuCI.

Пользовательский пакет зависит от установленного клиента (`qwdtt`).

### Сборка пакета LuCI из исходников

Структура пакета стандартная для LuCI (`htdocs`, `root`, `po`, `Makefile`
с `include ../../luci.mk`). Для сборки через OpenWrt:

1. Скопируйте каталог `luci-app-qwdtt` в `feeds/luci/applications/`:
   ```sh
   cp -r luci-app-qwdtt feeds/luci/applications/
   ```
2. Или подключите этот репозиторий как фид и соберите пакет через
   `$(TOPDIR)/feeds/luci/luci.mk`.
3. Затем обычная сборка OpenWrt (например, через SDK):
   ```sh
   ./scripts/feeds update -a
   ./scripts/feeds install luci-app-qwdtt
   make package/luci-app-qwdtt/compile
   ```

### Сборка ipk-артефакта

Артефакт `luci-app-qwdtt_1.0.0-1_all.ipk` собирается на GitHub Actions
(`node build-ipk.js`) и прикрепляется к каждому релизу вместе с архивами
клиента. Вручную собрать можно так:

```sh
node build-ipk.js
```

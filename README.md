# qWDTT OpenWrt

RAW-IP клиент qWDTT для роутеров OpenWrt с русскоязычным веб-интерфейсом LuCI.

Клиент поднимает на роутере интерфейс `qwdtt0` и направляет через туннель
IPv4-трафик устройств локальной сети. Роутер при этом сохраняет прямой доступ
к WAN, поэтому соединения с VK TURN не зацикливаются.

В этой сборке поддерживается только RAW-IP; WireGuard и SOCKS намеренно не
включены.

## Состав репозитория

| Каталог/файл | Назначение |
| --- | --- |
| `client/` | Исходники клиента (Go) |
| `files/` | Конфигурация OpenWrt: инициализационный скрипт, UCI-настройки, шаблон `config.json` |
| `install.sh` | Установщик клиента на роутер |
| `luci-app-qwdtt/` | Пакет веб-интерфейса LuCI (htdocs, root, po, Makefile) |
| `build-ipk.js` | Сборка `.ipk`-артефакта интерфейса без SDK OpenWrt |
| `.github/workflows/build.yml` | CI: сборка клиента под все архитектуры и публикация релизов |

Готовые артефакты — в разделе [Releases](../../releases/latest).

## Возможности

- Туннель поверх RAW 56003 без хранения учётных данных VK на роутере;
- Авторизация VK: анонимная и автоматическая обработка капчи;
- Веб-интерфейс LuCI: обзор со скоростями в реальном времени, настройки
  подключения и диагностика с копированием отчёта;
- Самопроверка TUN без данных сервера и VK.

## Требования

- Роутер с OpenWrt 25.12+ (или совместимой версией с `procd` и `firewall4`);
- Пакеты `ip-full`, `kmod-tun`, `ca-bundle`;
- Сервер qWDTT с включённым RAW-слушателем (UDP-порт `56003`);
- Данные выдачи VK: адрес сервера, пароль и хеш звонка.

## Установка

### 1. Клиент

1. Определите архитектуру роутера и скачайте подходящий архив из
   [Releases](../../releases/latest):

   | Артефакт | Для чего |
   | --- | --- |
   | `qwdtt-openwrt-x86_64.tar.gz` | x86-роутеры и виртуальные машины |
   | `qwdtt-openwrt-aarch64.tar.gz` | современные ARM64-роутеры |
   | `qwdtt-openwrt-armv7.tar.gz` | 32-битные ARMv7-устройства |
   | `qwdtt-openwrt-mipsel.tar.gz` | старые MIPS little-endian роутеры |

2. Установите от `root`:

   ```sh
   tar -xzf qwdtt-openwrt-aarch64.tar.gz
   cd qwdtt-openwrt-aarch64
   ./install.sh
   ```

3. Если установщик просит зависимости:

   ```sh
   # OpenWrt с apk
   apk update && apk add ip-full kmod-tun ca-bundle

   # старые OpenWrt с opkg
   opkg update && opkg install ip-full kmod-tun ca-bundle
   ```

   и повторите `./install.sh`.

### 2. Веб-интерфейс (LuCI)

Установите `luci-app-qwdtt_<версия>-1_all.ipk` из [Releases](../../releases/latest)
после установки клиента:

```sh
# opkg
opkg install luci-app-qwdtt_1.0.4-1_all.ipk

# apk
apk add --allow-untrusted luci-app-qwdtt_1.0.4-1_all.ipk
```

После установки войдите в LuCI заново — раздел **qWDTT** появится в меню
*Службы* (Обзор / Настройки / Диагностика). Пакет зависит от установленного
клиента (`qwdtt`).

## Настройка

Конфигурация клиента — `/etc/qwdtt/config.json`. Пример:
[`files/etc/qwdtt/config.json`](files/etc/qwdtt/config.json).

| Поле | Описание |
| --- | --- |
| `peer` | Адрес сервера в формате `host:порт`. Нужен именно RAW-листенер — UDP-порт **56003** (порт DTLS 56000 не подходит, подключение уйдёт в таймаут) |
| `password` | Пароль выдачи VK. Не публикуйте и не пересылайте его |
| `hashes` | Массив хешей звонка VK |
| `workers` | Количество воркеров, 9–108. Чем больше, тем выше нагрузка на CPU |
| `lan_interface` | Интерфейс LAN. По умолчанию `br-lan`; при другой сборке исправьте |
| `tun_name` | Имя TUN-интерфейса. При изменении обновите устройство зоны `qwdtt` во firewall |
| `no_dtls`, `turn_tcp` | Специальные режимы: отключение DTLS-фазы и TURN по TCP |

Остальные поля (`device_id`, `dns`, `obfs`, `captcha_mode`, `vk_auth`,
`vk_anon_path`) менять не нужно.

Запуск:

```sh
uci set qwdtt.main.enabled='1'
uci commit qwdtt
/etc/init.d/qwdtt start
```

Остановка:

```sh
/etc/init.d/qwdtt stop
```

## Проверка

```sh
logread -e qwdtt
```

Рабочее подключение пишет `RAW-конфиг получен`, затем `TUN подключён, трафик
пошёл`. Состояние интерфейса и маршрутизации:

```sh
ip addr show qwdtt0
ip rule show
ip route show table 51820
```

Самопроверка TUN без данных VK и сервера:

```sh
/usr/bin/qwdtt-client -rawtun-self-test 10.70.0.2
```

## Веб-интерфейс

- **Обзор** — статус службы (запуск/остановка), адрес TUN, скорости RX/TX
  в реальном времени, сервер, воркеры, количество VK-хешей.
- **Настройки** — адрес сервера, пароль (с показом/скрытием), VK-хеши, воркеры
  (пресеты 9–108), интерфейс LAN (список из роутера), блок «Дополнительно»
  (`no_dtls`, `turn_tcp`, `tun_name`), импорт/экспорт профиля.
- **Диагностика** — сводка состояния с кнопкой «Обновить», проверка VK-хешей
  и копирование диагностического отчёта (пароль и хеши в отчёт не попадают).

Все страницы обновляются автоматически раз в 3 секунды.
Расширенная инструкция — в [ИНСТРУКЦИЯ.md](ИНСТРУКЦИЯ.md).

## Сборка

### Клиент

```sh
cd client
go build -tags=openwrt -trimpath -ldflags="-s -w" -o ../qwdtt-client .
```

### Пакет LuCI через OpenWrt

```sh
cp -r luci-app-qwdtt feeds/luci/applications/
./scripts/feeds update -a
./scripts/feeds install luci-app-qwdtt
make package/luci-app-qwdtt/compile
```

### Артефакт ipk (без SDK)

```sh
node build-ipk.js
```

Версию пакета можно задать переменной `PKG_VERSION` (по умолчанию `1.0.0-1`).

## Релизы

CI в `.github/workflows/build.yml` собирает клиент под все архитектуры, собирает
ipk нужной версии и публикует GitHub Release с архивами и пакетом интерфейса.

Как выпустить новую версию:

1. Внесите изменения в `client/` и/или `luci-app-qwdtt/`, закоммитьте и запушьте
   в `main`.
2. Вкладка **Actions** → workflow **OpenWrt RAW client** → **Run workflow**,
   укажите версию (например `v1.0.5`) и запустите.

> Пуш тегов вида `v1.0.x` тоже запускает сборку, но на форках триггер по push
> может не сработать — надёжнее запускать вручную кнопкой Run workflow.

## Лицензия

GPL-3.0 — см. [LICENSE](LICENSE).
# 0.1.2 verification (2026-09-25)

Trusted MDX/custom React now runs in the top document DOM, without an iframe. Previous iframe isolation claims below describe historical releases only. HTTP token/Origin/Host validation and compiler import restrictions remain.

- 24 tests / 78 assertions and TypeScript passed.
- Browser: native DOM visibility, standard/custom persistence, annotation selection and lifecycle, reload, manual revision switching, custom effect cleanup, annotator toggle and preference persistence passed.
- Layout: 390/1440/2466px; stability: no neighboring widget rerender or fast-save flash.
- 50 browser reopen cycles: retained blank-page heap after warmup 881456 bytes, final 881456 bytes; SSE connections/listeners zero. This is not total browser process memory.
- Packaged executable MCP/HTTP smoke passed with isolated PATH/HOME.
- Codex native annotator interaction requires operator verification; top-DOM browser checks are not Desktop acceptance.
- Annotator preference is browser-origin-local. Harness-scoped MCP preferences and native-comment import are not implemented.

## Historical validation

# Проверка Blueprint v0.1.0

Дата: 2026-09-24. Среда: macOS arm64, Bun 1.4.2.

- TypeScript: `bun run typecheck` проходит.
- 19 тестов, 45 assertions: состояние/редакции/согласование, идемпотентность, восстановление транзакции, lock/symlink, отмена и таймаут ожидания, HTTP auth/Origin, MDX/local imports, запрещённые импорты и timeout compiler subprocess.
- Browser: реальный headless Chrome; вопрос, custom React state, выделение и комментарий, отправка пакета, восстановление после reload, ручное переключение редакции, повторная отправка после изменения только аннотации, быстрый ввод и запрет доступа iframe к DOM оболочки. Снимок проверки хранится в `.tmp/browser-check.png` (не включён в релиз).
- Executable: 63,630,450 bytes / 60.7 MiB. Проверен с PATH=/usr/bin:/bin и изолированным HOME: MCP handshake, 6 tools, компиляция MDX+TSX в дочернем процессе, HTTP submission → MCP wait.
- Soak: 120 циклов публикации, сборки, отмены wait и подключения/отключения SSE. После прогрева RSS 45,023,232 → 50,610,176 bytes, heap около 2.6–3.4 MB; по завершении каждого замера 0 подписок, 0 дочерних процессов, 0 SSE. Это ограниченная проверка, не доказательство отсутствия утечек при любой нагрузке.
- Дополнительный soak с фиксированными исходниками: 300 сборок, RSS после прогрева 43,335,680 → 51,724,288 bytes; последние 50 циклов около 51.7 MB, счётчики ресурсов — 0.
- Browser soak: 50 открытий/закрытий. Heap главной страницы после GC на about:blank: 760,848 → 760,976 bytes после прогрева; подписки/SSE — 0. Это измерение не включает все процессы Chrome. Найденный таймаут iframe устранён созданием фрейма только после готовности исходников; тот же сценарий затем прошёл.
- Plugin validator и skill validator проходят. Для PyYAML использовано только временное `.tmp/validation-env`, не runtime-зависимость плагина.

Пользователь подтвердил успешную установку ZIP через штатный интерфейс Codex. Работа инструментов в отдельной новой задаче Desktop независимо не проверена; MCP smoke-test не заменяет эту проверку.

Сборщик Bun выдаёт предупреждение при разборе комментария зависимости estree-util-build-jsx (Unsupported JSX runtime). Сборка завершается, MDX и custom TSX проверены именно в полученном бинарнике.

## Исправления 0.1.1

Регрессия в реальном Chromium до исправления: сохранение одного вопроса вызвало один лишний render соседнего custom-виджета и вспышку Saving; iframe при этом не навигировал и srcdoc не менялся. После исправления неизменившиеся состояния сохраняют объектную идентичность: render соседнего виджета не меняется, быстрый save не показывает вспышку. Проверены также медленное сохранение, явная ошибка без ложного Saved, подтверждение отправки, копирование сообщения с правильным cursor и получение пакета ожидающим читателем. Проверка `bun run check:stability` включена в CI.

Пакет пользовательского демо №29 получен ожидающим MCP-клиентом. Автоматического возобновления завершённого хода нет; новое окно подтверждения сообщает о сохранении и даёт текст для продолжения чата. Установленная пользователем версия 0.1.0 автоматически не заменяется.

## Stateful artifacts (development checkpoint)

Кнопка отправки и API создания пакетов удалены. Сохранены файлы submissions предыдущих версий. Девять MCP-инструментов проверены в бинарнике из ZIP: чтение текущего артефакта, публикация с expectedEvent, журнал изменений, ожидание, курсор обработки, аннотации и проверка ролей. Миграция v1 → v2 сохраняет исходный snapshot в migration-v1.json, цитаты и старые пакеты.

24 unit/integration tests проверяют жизненный цикл, авторство, запрет закрытия/архивации агентом, историю редактирования, конфликты/повторы, миграцию, страницы журнала и курсоры. Chromium проверяет ответы и custom-state, аннотации и ответы обеих сторон, приёмку оператором, архив/восстановление, сохранение и редактирование черновика после reload, смену редакции. Проверка мерцания, медленного/неудачного сохранения сохранена и проходит.

Новая версия не устанавливается автоматически. Проверка встроенного подключения MCP к Codex по-прежнему отдельна от проверки executable и демо-клиента. Старые измерения soak относятся к 0.1.x; для изменённого lifecycle дополнительно выполнен короткий 30-цикловый smoke soak, не заменяющий длительное измерение.

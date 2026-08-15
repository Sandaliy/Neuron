# Copy audit

Every user visible string in the product, in both languages, with what looks wrong with it.

Regenerate with `pnpm copy-audit`. Do not edit by hand.

Generated from `packages/shared/src/i18n/en.ts` and `ru.ts`, which is where every string lives:
nothing user visible is written in a component. The flags are mechanical and some of them are
wrong; the length one fires on short labels where two characters either way is a large
percentage. They are a list to read, not a list of defects.

## Already applied

These were not judgement calls, so they are done rather than listed:

- English says two-factor authentication, then 2FA after the first mention.
- Russian says двухфакторная аутентификация, then 2FA. "Вход в два шага" is gone.
- Russian addresses the reader as ты throughout. Thirty strings used вы.
- The four security buttons name what they change instead of naming a verb.
- `common.close` and `common.loading` exist. Both were English written into a component.

The first three are checked by `packages/shared/src/i18n/i18n.test.ts`, so they cannot
come back without failing the build.

## The count

| | |
| --- | --- |
| Strings, each in two languages | **172** |
| Referenced by name somewhere in `apps/` | 144 |
| Reached only through a computed key (`error.${code}`) | 28 |
| Present in one language only | 0 |
| Carrying at least one flag | 51 |

## What the flags mean

| Flag | Meaning | Count |
| --- | --- | --- |
| `length` | The two languages differ in length by more than 40%. Russian normally runs 10 to 15% longer than English, so a gap this wide usually means one side says something the other does not. | 32 |
| `sentences` | One language uses a different number of sentences from the other. Same signal as length, harder to argue with. | 0 |
| `placeholders` | The two carry different placeholders. One of them will render a literal brace. | 0 |
| `form-of-address` | Russian addresses the reader as вы. This project uses ты. | 0 |
| `calque` | A phrase translated word for word out of English. Nobody says it in Russian. | 0 |
| `bare-verb` | A control whose label is a verb and nothing else. It does not say what it affects. | 6 |
| `no-next-step` | An error or refusal that names the problem without saying what to do about it. | 21 |
| `only-en` | Exists in English only. | 0 |
| `only-ru` | Exists in Russian only. | 0 |
| `unreferenced` | No code refers to this key. Either dead, or reached through a computed key. | 0 |

## Flagged strings

| Key | Flags | English | Russian |
| --- | --- | --- | --- |
| `auth.password.confirmMismatch` | length-60% | The two passwords are different. | Пароли не совпадают. |
| `auth.password.tooCommon` | length-64% | That is one of the first passwords an attacker tries. Pick something else. | Такой пароль подбирают первым. Выбери другой. |
| `auth.password.tooLong` | no-next-step | That is longer than 200 characters. | Это длиннее 200 символов. |
| `auth.password.tooShort` | no-next-step | Use at least 10 characters. | Нужно не меньше 10 символов. |
| `auth.recovery.invalid` | length-58%, no-next-step | That code is not right, or it has already been used. | Код неверный или уже использован. |
| `auth.recoveryCodes.copied` | length-83% | Copied | Скопировано |
| `auth.recoveryCodes.copy` | length-60% | Copy codes | Скопировать коды |
| `auth.reset.title` | length-58% | Reset your password | Сброс пароля |
| `auth.signIn.failed` | no-next-step | That email and password do not go together. | Эта почта и этот пароль не подходят друг к другу. |
| `auth.signIn.forgot` | length-46% | Lost your password? | Забыл пароль? |
| `auth.signIn.title` | length-75% | Sign in | Вход |
| `auth.twoFactor.invalid` | length-77%, no-next-step | That code is not right. | Код неверный. |
| `auth.twoFactor.manualTitle` | length-53% | Enter the key by hand instead | Ввести ключ вручную |
| `auth.twoFactor.reused` | length-51% | That code has already been used. Wait for the app to show a new one. | Этот код уже использован. Дождись следующего. |
| `auth.twoFactor.secretLabel` | length-40% | Cannot scan it? Type this into the app instead. | Не получается отсканировать? Введи этот ключ в приложение вручную. |
| `auth.twoFactor.unavailable` | no-next-step | 2FA is not set up on this account. | 2FA на этом аккаунте не настроена. |
| `common.cancel` | bare-verb-label | Cancel | Отмена |
| `common.close` | bare-verb-label | Close | Закрыть |
| `common.continue` | bare-verb-label | Continue | Продолжить |
| `common.retry` | length-111%, bare-verb-label | Try again | Попробовать ещё раз |
| `common.save` | length-125%, bare-verb-label | Save | Сохранить |
| `common.signOut` | length-60%, bare-verb-label | Sign out | Выйти |
| `error.deck_cycle` | no-next-step | A deck cannot be moved inside itself. | Колоду нельзя переместить внутрь самой себя. |
| `error.direction_unavailable` | no-next-step | That card direction is not available. | Это направление карточки недоступно. |
| `error.email_not_verified` | no-next-step | Confirm your email address first. | Сначала подтверди адрес почты. |
| `error.email_taken` | no-next-step | That address already has an account. | У этого адреса уже есть аккаунт. |
| `error.invalid_credentials` | no-next-step | That email and password do not go together. | Эта почта и этот пароль не подходят друг к другу. |
| `error.invalid_note_fields` | no-next-step | Those fields do not match the note type. | Эти поля не подходят к типу заметки. |
| `error.invalid_recovery_code` | length-58%, no-next-step | That code is not right, or it has already been used. | Код неверный или уже использован. |
| `error.invalid_request` | length-67%, no-next-step | Something in that request was not right. | В запросе что-то не так. |
| `error.invalid_two_factor_code` | length-77%, no-next-step | That code is not right. | Код неверный. |
| `error.name_taken` | no-next-step | That name is already used here. | Такое имя здесь уже занято. |
| `error.no_recovery_codes` | no-next-step | No recovery codes are left on this account. | На этом аккаунте не осталось кодов восстановления. |
| `error.not_authenticated` | no-next-step | Sign in to continue. | Войди, чтобы продолжить. |
| `error.not_found` | no-next-step | That is not here. | Этого здесь нет. |
| `error.two_factor_unavailable` | no-next-step | 2FA is not set up on this account. | 2FA на этом аккаунте не настроена. |
| `error.unknown_note_type` | no-next-step | That note type does not exist. | Такого типа заметки не существует. |
| `library.dueLabel` | length-62% | Cards waiting | Карточек к повторению |
| `library.newLabel` | length-65% | Cards never answered | Карточек, которых ты ещё не видел |
| `library.title` | length-43% | Library | Библиотека |
| `nav.library` | length-43% | Library | Библиотека |
| `settings.changePasswordAction` | length-43% | Change your password | Сменить пароль |
| `settings.deleted` | length-47% | The account is closed. | Аккаунт закрыт. |
| `settings.glass.full` | length-167% | Max | Максимум |
| `settings.glass.off` | length-200% | Off | Выключить |
| `settings.language` | length-100% | Language | Язык |
| `settings.motion.reduce` | length-200% | Off | Выключить |
| `settings.security` | length-50% | Security | Безопасность |
| `settings.theme.dark` | length-50% | Dark | Тёмная |
| `settings.theme.system` | length-50% | System | Системная |
| `today.newLabel` | length-67% | new | новых |

## Every string

| Key | English | Russian |
| --- | --- | --- |
| `app.name` | Neuron | Neuron |
| `app.tagline` | Spaced repetition that schedules your time, not your card count | Интервальные повторения, которые планируют время, а не количество карточек |
| `auth.email.invalidToken` | That link is not valid any more. Ask for a new one. | Эта ссылка больше не действует. Запроси новую. |
| `auth.email.label` | Email | Почта |
| `auth.email.resend` | Send it again | Отправить ещё раз |
| `auth.email.verified` | Email confirmed. | Почта подтверждена. |
| `auth.email.verifyRequired` | Confirm your email address to start using the app. | Подтверди адрес почты, чтобы начать пользоваться приложением. |
| `auth.email.verifySent` | If that address has an account, a link is on its way. | Если у этого адреса есть аккаунт, письмо уже в пути. |
| `auth.email.verifyTitle` | Confirm your email | Подтверди почту |
| `auth.password.confirmHint` | There is no email recovery here, so a password typed wrong twice cannot be undone. | Восстановления по почте здесь нет, поэтому дважды опечатанный пароль уже не отменить. |
| `auth.password.confirmLabel` | Type the password again | Введи пароль ещё раз |
| `auth.password.confirmMatch` | Both fields match. | Оба поля совпадают. |
| `auth.password.confirmMismatch` | The two passwords are different. | Пароли не совпадают. |
| `auth.password.hide` | Hide the password | Скрыть пароль |
| `auth.password.hint` | At least 10 characters. Length matters more than symbols. | Не меньше 10 символов. Длина важнее спецсимволов. |
| `auth.password.label` | Password | Пароль |
| `auth.password.show` | Show the password | Показать пароль |
| `auth.password.strength.fair` | Long enough. Another few characters, or one more word, is the easiest way to make it stronger. | Длины хватает. Ещё несколько символов или ещё одно слово - самый простой способ усилить пароль. |
| `auth.password.strength.good` | Good length. Another word would make it harder still. | Хорошая длина. Ещё одно слово сделает его ещё крепче. |
| `auth.password.strength.strong` | Long enough that length is no longer the weak part. | Такой длины хватает: слабое место теперь точно не в ней. |
| `auth.password.tooCommon` | That is one of the first passwords an attacker tries. Pick something else. | Такой пароль подбирают первым. Выбери другой. |
| `auth.password.tooLong` | That is longer than 200 characters. | Это длиннее 200 символов. |
| `auth.password.tooShort` | Use at least 10 characters. | Нужно не меньше 10 символов. |
| `auth.recovery.exhausted` | Every recovery code for this account has been used. Get in touch so it can be reset by hand. | Все коды восстановления этого аккаунта использованы. Напиши нам, чтобы сбросить пароль вручную. |
| `auth.recovery.hint` | Type one of the codes you saved when you created the account. | Введи один из кодов, сохранённых при создании аккаунта. |
| `auth.recovery.invalid` | That code is not right, or it has already been used. | Код неверный или уже использован. |
| `auth.recovery.setPassword` | Choose a new password | Придумай новый пароль |
| `auth.recovery.setPasswordHint` | The code has been used up. Choose a new password to finish signing in. | Код израсходован. Задай новый пароль, чтобы закончить вход. |
| `auth.recovery.signedOutElsewhere` | Everywhere else has been signed out. | На всех остальных устройствах выполнен выход. |
| `auth.recovery.title` | Sign in with a recovery code | Вход по коду восстановления |
| `auth.recoveryCodes.confirm` | I have saved them | Я их сохранил |
| `auth.recoveryCodes.copied` | Copied | Скопировано |
| `auth.recoveryCodes.copy` | Copy codes | Скопировать коды |
| `auth.recoveryCodes.download` | Download codes | Скачать коды |
| `auth.recoveryCodes.fileName` | neuron-recovery-codes.txt | neuron-recovery-codes.txt |
| `auth.recoveryCodes.low` | Only {count} recovery codes left. Generate a new set. | Осталось всего {count} кодов восстановления. Выпусти новые. |
| `auth.recoveryCodes.none` | No recovery codes left. Generate a new set now, while you still know your password. | Кодов восстановления не осталось. Выпусти новые сейчас, пока помнишь пароль. |
| `auth.recoveryCodes.regenerate` | Generate new codes | Выпустить новые коды |
| `auth.recoveryCodes.regenerateWarning` | This replaces every code you have. The old ones stop working immediately. | Это заменит все твои коды. Старые перестанут работать сразу же. |
| `auth.recoveryCodes.remaining` | Recovery codes left: {count} | Осталось кодов восстановления: {count} |
| `auth.recoveryCodes.subtitle` | Ten codes. Each one works once. They are the only way back into this account if you forget your password. | Десять кодов. Каждый работает один раз. Это единственный способ вернуться в аккаунт, если забудешь пароль. |
| `auth.recoveryCodes.title` | Your recovery codes | Твои коды восстановления |
| `auth.recoveryCodes.warning` | Anyone holding one of these codes can take over your account without your password. Keep them the way you would keep the password itself: written down somewhere private, or in a password manager. We cannot show them to you again. | Любой, у кого есть один из этих кодов, войдёт в твой аккаунт без пароля. Храни их так же, как сам пароль: на бумаге в закрытом ящике или в менеджере паролей. Показать их ещё раз мы не сможем. |
| `auth.register.closed` | New accounts are closed right now. If you already have one, you can still sign in. | Регистрация сейчас закрыта. Если аккаунт уже есть, войти по-прежнему можно. |
| `auth.register.haveAccount` | Already have an account? Sign in. | Аккаунт уже есть? Войди. |
| `auth.register.submit` | Create account | Создать аккаунт |
| `auth.register.title` | Create an account | Создать аккаунт |
| `auth.reset.done` | Password changed. Everywhere else has been signed out. | Пароль изменён. На всех остальных устройствах выполнен выход. |
| `auth.reset.sent` | If that address has an account, a link is on its way. | Если у этого адреса есть аккаунт, письмо уже в пути. |
| `auth.reset.title` | Reset your password | Сброс пароля |
| `auth.signIn.failed` | That email and password do not go together. | Эта почта и этот пароль не подходят друг к другу. |
| `auth.signIn.forgot` | Lost your password? | Забыл пароль? |
| `auth.signIn.noAccount` | No account yet? Create one. | Аккаунта ещё нет? Создай. |
| `auth.signIn.recover` | Sign in with a recovery code | Войти по коду восстановления |
| `auth.signIn.submit` | Sign in | Войти |
| `auth.signIn.title` | Sign in | Вход |
| `auth.twoFactor.codeLabel` | Six digit code | Шестизначный код |
| `auth.twoFactor.confirmHint` | Type the code the app shows. Until you do, 2FA is not on. | Введи код, который показывает приложение. Пока этого нет, 2FA не включена. |
| `auth.twoFactor.disable` | Turn off 2FA | Выключить 2FA |
| `auth.twoFactor.disabled` | 2FA is off. | 2FA выключена. |
| `auth.twoFactor.enable` | Turn on 2FA | Включить 2FA |
| `auth.twoFactor.enabled` | 2FA is on. | 2FA включена. |
| `auth.twoFactor.invalid` | That code is not right. | Код неверный. |
| `auth.twoFactor.manualHint` | Paste this key into your authenticator app under "add account by key". It is the same account the QR code sets up, so use one or the other, not both. | Вставь этот ключ в приложение-аутентификатор через "добавить аккаунт по ключу". Это тот же аккаунт, что настраивает QR-код, так что нужно что-то одно, не оба сразу. |
| `auth.twoFactor.manualTitle` | Enter the key by hand instead | Ввести ключ вручную |
| `auth.twoFactor.password` | Your password | Твой пароль |
| `auth.twoFactor.passwordHint` | Asked for because turning this on issues new codes. | Спрашиваем потому, что при включении выдаётся новая пачка кодов. |
| `auth.twoFactor.recoveryCodes.title` | Codes for a lost phone | Коды на случай потери телефона |
| `auth.twoFactor.recoveryCodes.warning` | These ten codes are separate from your account recovery codes, and they exist for one reason: getting in when you no longer have your phone. Save them now. Without them, a lost phone means a lost account. | Эти десять кодов не связаны с кодами восстановления аккаунта и нужны для одного: войти, когда телефона под рукой больше нет. Сохрани их сейчас. Без них потерянный телефон означает потерянный аккаунт. |
| `auth.twoFactor.reused` | That code has already been used. Wait for the app to show a new one. | Этот код уже использован. Дождись следующего. |
| `auth.twoFactor.scan` | Scan this with your authenticator app. | Отсканируй этот код приложением-аутентификатором. |
| `auth.twoFactor.secretCopied` | Setup key copied | Ключ скопирован |
| `auth.twoFactor.secretCopy` | Copy the setup key | Скопировать ключ |
| `auth.twoFactor.secretLabel` | Cannot scan it? Type this into the app instead. | Не получается отсканировать? Введи этот ключ в приложение вручную. |
| `auth.twoFactor.setUp` | Set up two-factor authentication | Настроить двухфакторную аутентификацию |
| `auth.twoFactor.subtitle` | Optional. Adds a six digit code from an app on your phone to every sign in. | По желанию. Добавляет к каждому входу шестизначный код из приложения на телефоне. |
| `auth.twoFactor.title` | Two-factor authentication | Двухфакторная аутентификация |
| `auth.twoFactor.unavailable` | 2FA is not set up on this account. | 2FA на этом аккаунте не настроена. |
| `common.cancel` | Cancel | Отмена |
| `common.close` | Close | Закрыть |
| `common.continue` | Continue | Продолжить |
| `common.loading` | Loading | Загрузка |
| `common.retry` | Try again | Попробовать ещё раз |
| `common.save` | Save | Сохранить |
| `common.signOut` | Sign out | Выйти |
| `error.deck_cycle` | A deck cannot be moved inside itself. | Колоду нельзя переместить внутрь самой себя. |
| `error.direction_unavailable` | That card direction is not available. | Это направление карточки недоступно. |
| `error.email_not_verified` | Confirm your email address first. | Сначала подтверди адрес почты. |
| `error.email_taken` | That address already has an account. | У этого адреса уже есть аккаунт. |
| `error.internal_error` | Something went wrong at our end. Try again in a moment, and quote this if it keeps happening: {correlationId} | Что-то сломалось на нашей стороне. Попробуй ещё раз, а если повторится, назови этот номер: {correlationId} |
| `error.invalid_credentials` | That email and password do not go together. | Эта почта и этот пароль не подходят друг к другу. |
| `error.invalid_note_fields` | Those fields do not match the note type. | Эти поля не подходят к типу заметки. |
| `error.invalid_recovery_code` | That code is not right, or it has already been used. | Код неверный или уже использован. |
| `error.invalid_request` | Something in that request was not right. | В запросе что-то не так. |
| `error.invalid_token` | That link is not valid any more. Ask for a new one. | Эта ссылка больше не действует. Запроси новую. |
| `error.invalid_two_factor_code` | That code is not right. | Код неверный. |
| `error.name_taken` | That name is already used here. | Такое имя здесь уже занято. |
| `error.network_unreachable` | This device cannot reach the server. Check the connection and try again. Your work is saved here. | Устройство не может связаться с сервером. Проверь соединение и попробуй ещё раз. Работа сохранена здесь. |
| `error.no_recovery_codes` | No recovery codes are left on this account. | На этом аккаунте не осталось кодов восстановления. |
| `error.not_allowed` | That action was refused. Reload the page and try again. | Это действие отклонено. Обнови страницу и попробуй ещё раз. |
| `error.not_authenticated` | Sign in to continue. | Войди, чтобы продолжить. |
| `error.not_found` | That is not here. | Этого здесь нет. |
| `error.password_change_required` | Choose a new password to finish signing in. | Задай новый пароль, чтобы закончить вход. |
| `error.rate_limited` | Too many tries. Wait {seconds} seconds. | Слишком много попыток. Подожди {seconds} секунд. |
| `error.registration_closed` | New accounts are closed right now. If you already have one, you can still sign in. | Регистрация сейчас закрыта. Если аккаунт уже есть, войти по-прежнему можно. |
| `error.service_unavailable` | The server is not answering. Your work is saved on this device. | Сервер не отвечает. Работа сохранена на устройстве. |
| `error.sync_rejected` | Those changes could not be saved. They are still on this device. | Эти изменения не удалось сохранить. Они остались на устройстве. |
| `error.two_factor_code_reused` | That code has already been used. Wait for a new one. | Этот код уже использован. Дождитесь следующего. |
| `error.two_factor_required` | Type the code from your authenticator app. | Введи код из приложения-аутентификатора. |
| `error.two_factor_unavailable` | 2FA is not set up on this account. | 2FA на этом аккаунте не настроена. |
| `error.unexpected` | Something went wrong. Try again in a moment. | Что-то пошло не так. Попробуй ещё раз. |
| `error.unknown_note_type` | That note type does not exist. | Такого типа заметки не существует. |
| `error.untrusted_origin` | The server does not recognise this web address. Open the app at its usual address and sign in there. | Сервер не знает этот веб-адрес. Открой приложение по его обычному адресу и войди там. |
| `error.weak_password` | Pick a longer or less common password. | Выбери пароль длиннее или менее распространённый. |
| `library.collapse` | Hide what is inside | Скрыть, что внутри |
| `library.dueLabel` | Cards waiting | Карточек к повторению |
| `library.emptyBody` | Decks show up here as soon as there are any. Making them arrives in phase 6. | Колоды появятся здесь, как только они будут. Создание колод появится на шестом этапе. |
| `library.emptyTitle` | No decks yet | Колод пока нет |
| `library.expand` | Show what is inside | Показать, что внутри |
| `library.newLabel` | Cards never answered | Карточек, которых ты ещё не видел |
| `library.readOnly` | Reading only for now. Making and moving decks arrives in phase 6. | Пока только чтение. Создание и перенос колод появятся на шестом этапе. |
| `library.title` | Library | Библиотека |
| `nav.library` | Library | Библиотека |
| `nav.settings` | Settings | Настройки |
| `nav.today` | Today | Сегодня |
| `settings.account` | Account | Аккаунт |
| `settings.appearance` | Appearance | Внешний вид |
| `settings.changePassword` | Change password | Сменить пароль |
| `settings.changePasswordAction` | Change your password | Сменить пароль |
| `settings.currentPassword` | Current password | Текущий пароль |
| `settings.deleteAccount` | Delete account | Удалить аккаунт |
| `settings.deleteAccountAction` | Delete this account and everything in it | Удалить этот аккаунт и всё, что в нём |
| `settings.deleteAccountConfirm` | Type the words below to confirm | Набери фразу ниже, чтобы подтвердить |
| `settings.deleteAccountPhrase` | delete my account | delete my account |
| `settings.deleteAccountWarning` | This closes the account and takes the decks, the notes and the whole review history with it. The rows are erased for good after thirty days, and nothing inside the app can stop that once it has started. | Аккаунт закроется, а вместе с ним уйдут колоды, заметки и вся история повторений. Через тридцать дней строки стираются окончательно, и изнутри приложения это уже не остановить. |
| `settings.deleted` | The account is closed. | Аккаунт закрыт. |
| `settings.glass` | Liquid glass | Жидкое стекло |
| `settings.glass.full` | Max | Максимум |
| `settings.glass.off` | Off | Выключить |
| `settings.glass.subtle` | Medium | Умеренно |
| `settings.glassCapped.frames` | Scrolling dropped below 55 frames a second here, so the panels stepped down. Reload to try the full setting again. | Прокрутка здесь упала ниже 55 кадров в секунду, и панели убавились сами. Перезагрузи страницу, чтобы снова попробовать максимум. |
| `settings.glassCapped.memory` | This device reports little memory, so the panels are running at Medium. | Устройство сообщает о малом объёме памяти, поэтому панели идут на «Умеренно». |
| `settings.glassCapped.motion` | Your system asks for less movement, so the panels are running at Medium. | Система просит меньше движения, поэтому панели идут на «Умеренно». |
| `settings.glassHint` | Turn this down if scrolling stutters on your phone. | Убавь, если прокрутка на телефоне дёргается. |
| `settings.language` | Language | Язык |
| `settings.motion` | Less movement | Меньше движения |
| `settings.motion.reduce` | Off | Выключить |
| `settings.motion.system` | Follow the system | Как в системе |
| `settings.motionHint` | Nothing slides or fades. States still change, they just change at once. | Ничего не выезжает и не проявляется. Состояния меняются, просто сразу. |
| `settings.newPassword` | New password | Новый пароль |
| `settings.passwordChanged` | Password changed. Everywhere else has been signed out. | Пароль изменён. Везде остальном выполнен выход. |
| `settings.regenerateAction` | Replace your recovery codes | Заменить коды восстановления |
| `settings.security` | Security | Безопасность |
| `settings.theme` | Theme | Тема |
| `settings.theme.dark` | Dark | Тёмная |
| `settings.theme.light` | Light | Светлая |
| `settings.theme.system` | System | Системная |
| `settings.title` | Settings | Настройки |
| `today.deckCounts` | {due} to review · {fresh} new | {due} на повтор · {fresh} новых |
| `today.emptyBody` | Cards appear here on the day they are due. | Карточки появятся здесь в тот день, когда придёт их черёд. |
| `today.emptyTitle` | Nothing is waiting | Ничего не ждёт |
| `today.estimate` | About {minutes} minutes | Примерно {minutes} минут |
| `today.estimateHint` | Worked out from a typical answer time. It turns into a real measurement once there are a few days of answers to measure. | Посчитано по обычному времени ответа. Станет настоящим измерением, когда наберётся несколько дней ответов. |
| `today.newAvailable` | New cards ready to start: {count} | Новых карточек готово: {count} |
| `today.newAvailableHint` | How many of them a session actually introduces is decided when studying starts, from how much time the reviews already need. | Сколько из них попадёт в занятие, решается при его начале, исходя из того, сколько времени уже занимают повторения. |
| `today.newLabel` | new | новых |
| `today.study` | Study | Учить |
| `today.studyLater` | The study screen is not built yet. It arrives in phase 7. | Экран занятия ещё не готов. Он появится на седьмом этапе. |
| `today.title` | Today | Сегодня |
| `today.waiting` | Cards waiting: {count} | Карточек к повторению: {count} |
| `today.waitingIn` | Waiting in | Ждёт в наборах |
| `today.waitingLabel` | cards to review | карточки на повтор |

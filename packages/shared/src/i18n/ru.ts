import type { Messages } from './en.js';

/**
 * Russian.
 *
 * Typed as `Messages`, so a key added to `en` and forgotten here is a
 * compilation error rather than a blank space on somebody's screen.
 */
export const ru: Messages = {
  'auth.register.title': 'Создать аккаунт',
  'auth.register.submit': 'Создать аккаунт',
  'auth.register.closed':
    'Регистрация сейчас закрыта. Если аккаунт уже есть, войти по-прежнему можно.',

  'auth.password.label': 'Пароль',
  'auth.password.tooShort': 'Нужно не меньше 10 символов.',
  'auth.password.tooLong': 'Это длиннее 200 символов.',
  'auth.password.tooCommon': 'Такой пароль подбирают первым. Выбери другой.',
  'auth.password.hint': 'Не меньше 10 символов. Длина важнее спецсимволов.',
  'auth.password.show': 'Показать пароль',
  'auth.password.hide': 'Скрыть пароль',

  'auth.password.strength.fair':
    'Длины хватает. Ещё несколько символов или ещё одно слово - самый простой способ усилить пароль.',
  'auth.password.strength.good': 'Хорошая длина. Ещё одно слово сделает его ещё крепче.',
  'auth.password.strength.strong': 'Такой длины хватает: слабое место теперь точно не в ней.',
  'auth.password.confirmLabel': 'Введи пароль ещё раз',
  'auth.password.confirmMatch': 'Оба поля совпадают.',
  'auth.password.confirmMismatch': 'Пароли не совпадают.',
  'auth.password.confirmHint':
    'Восстановления по почте здесь нет, поэтому дважды опечатанный пароль уже не отменить.',

  'auth.signIn.title': 'Вход',
  'auth.signIn.submit': 'Войти',
  'auth.signIn.failed': 'Эта почта и этот пароль не подходят друг к другу.',
  'auth.signIn.forgot': 'Забыл пароль?',

  'auth.recoveryCodes.title': 'Твои коды восстановления',
  'auth.recoveryCodes.warning':
    'Любой, у кого есть один из этих кодов, войдёт в твой аккаунт без пароля. Храни их так же, как сам пароль: на бумаге в закрытом ящике или в менеджере паролей. Показать их ещё раз мы не сможем.',
  'auth.recoveryCodes.subtitle':
    'Десять кодов, каждый на один раз. Единственный способ вернуться, если забудешь пароль.',
  'auth.recoveryCodes.copy': 'Скопировать',
  'auth.recoveryCodes.copied': 'Скопировано',
  'auth.recoveryCodes.download': 'Скачать',
  'auth.recoveryCodes.confirm': 'Я их сохранил',
  'auth.recoveryCodes.remaining': 'Осталось кодов восстановления: {count}',
  'auth.recoveryCodes.low': 'Осталось всего {count} кодов восстановления. Выпусти новые.',
  'auth.recoveryCodes.none':
    'Кодов восстановления не осталось. Выпусти новые сейчас, пока помнишь пароль.',
  'auth.recoveryCodes.regenerate': 'Выпустить новые коды',
  'auth.recoveryCodes.regenerateWarning':
    'Это заменит все твои коды. Старые перестанут работать сразу же.',

  'auth.recovery.title': 'Вход по коду восстановления',
  'auth.recovery.hint': 'Введи один из кодов, сохранённых при создании аккаунта.',
  'auth.recovery.invalid': 'Код неверный или уже использован.',
  'auth.recovery.exhausted':
    'Все коды восстановления этого аккаунта использованы. Напиши нам, чтобы сбросить пароль вручную.',
  'auth.recovery.setPassword': 'Придумай новый пароль',
  'auth.recovery.setPasswordHint': 'Код израсходован. Задай новый пароль, чтобы закончить вход.',
  'auth.recovery.signedOutElsewhere': 'На всех остальных устройствах выполнен выход.',

  'auth.twoFactor.title': 'Двухфакторная аутентификация',
  'auth.twoFactor.subtitle':
    'По желанию. Добавляет к каждому входу шестизначный код из приложения на телефоне.',
  'auth.twoFactor.enable': 'Включить 2FA',
  'auth.twoFactor.disable': 'Выключить 2FA',
  'auth.twoFactor.scan': 'Отсканируй этот код приложением-аутентификатором.',
  'auth.twoFactor.confirmHint':
    'Введи код, который показывает приложение. Пока этого нет, 2FA не включена.',
  'auth.twoFactor.codeLabel': 'Шестизначный код',
  'auth.twoFactor.invalid': 'Код неверный.',
  'auth.twoFactor.reused': 'Этот код уже использован. Дождись следующего.',
  'auth.twoFactor.unavailable': '2FA на этом аккаунте не настроена.',
  'auth.twoFactor.on': 'Включена',
  'auth.twoFactor.off': 'Выключена',
  'auth.twoFactor.enabled': '2FA включена.',
  'auth.twoFactor.disabled': '2FA выключена.',
  'auth.twoFactor.recoveryCodes.warning':
    'Эти десять кодов не связаны с кодами восстановления аккаунта и нужны для одного: войти, когда телефона под рукой больше нет. Сохрани их сейчас. Без них потерянный телефон означает потерянный аккаунт.',
  'auth.twoFactor.recoveryCodes.title': 'Коды на случай потери телефона',

  'auth.email.verifyTitle': 'Подтверди почту',
  'auth.email.verifySent': 'Если у этого адреса есть аккаунт, письмо уже в пути.',
  'auth.email.verifyRequired': 'Подтверди адрес почты, чтобы начать пользоваться приложением.',
  'auth.email.resend': 'Отправить ещё раз',
  'auth.email.verified': 'Почта подтверждена.',
  'auth.email.invalidToken': 'Эта ссылка больше не действует. Запроси новую.',

  'auth.reset.title': 'Сброс пароля',
  'auth.reset.sent': 'Если у этого адреса есть аккаунт, письмо уже в пути.',
  'auth.reset.done': 'Пароль изменён. На всех остальных устройствах выполнен выход.',

  'app.name': 'Neuron',
  'app.tagline': 'Интервальные повторения, которые планируют время, а не количество карточек',

  'nav.today': 'Сегодня',
  'nav.library': 'Библиотека',
  'nav.settings': 'Настройки',

  'common.cancel': 'Отмена',
  'common.back': 'Назад',
  'common.continue': 'Продолжить',
  'common.save': 'Сохранить',
  'common.close': 'Закрыть',
  'common.retry': 'Попробовать ещё раз',
  'common.loading': 'Загрузка',
  'common.signOut': 'Выйти',

  'auth.email.label': 'Почта',
  'auth.signIn.noAccount': 'Аккаунта ещё нет? Создай.',
  'auth.signIn.recover': 'Войти по коду восстановления',
  'auth.register.haveAccount': 'Аккаунт уже есть? Войди.',
  'auth.recoveryCodes.fileName': 'neuron-recovery-codes.txt',
  'auth.twoFactor.secretLabel':
    'Не получается отсканировать? Введи этот ключ в приложение вручную.',
  'auth.twoFactor.password': 'Твой пароль',
  'auth.twoFactor.disableHint':
    'Для выключения нужен пароль и код из приложения, как и для включения.',
  'auth.twoFactor.scanDone': 'Добавил',

  'auth.twoFactor.manualTitle': 'Ввести ключ вручную',
  'auth.twoFactor.manualHint':
    'Вставь этот ключ в приложение-аутентификатор через "добавить аккаунт по ключу". Это тот же аккаунт, что настраивает QR-код, так что нужно что-то одно, не оба сразу.',
  'auth.twoFactor.secretCopy': 'Скопировать ключ',
  'auth.twoFactor.secretCopied': 'Ключ скопирован',
  'settings.changePasswordAction': 'Сменить пароль',
  'settings.regenerateAction': 'Заменить коды восстановления',
  'settings.deleteAccountAction': 'Удалить аккаунт',

  'today.title': 'Сегодня',
  'today.waitingIn': 'Ждёт в наборах',
  'today.waitingLabel': 'карточки на повтор',
  'today.newLabel': 'новых',
  'today.deckCounts': '{due} на повтор · {fresh} новых',
  'today.waiting': 'Карточек к повторению: {count}',
  'today.newAvailable': 'Новых карточек готово: {count}',
  'today.newAvailableHint':
    'Сколько из них попадёт в занятие, решается при его начале, исходя из того, сколько времени уже занимают повторения.',
  'today.estimate': 'Примерно {minutes} минут',
  'today.estimateHint':
    'Посчитано по обычному времени ответа. Станет настоящим измерением, когда наберётся несколько дней ответов.',
  'today.study': 'Учить',
  'today.studyLater': 'Экран занятия ещё не готов. Он появится на седьмом этапе.',
  'today.emptyTitle': 'Ничего не ждёт',
  'today.emptyBody': 'Карточки появятся здесь в тот день, когда придёт их черёд.',

  'library.title': 'Библиотека',
  'library.dueLabel': 'Карточек к повторению',
  'library.newLabel': 'Карточек, которых ты ещё не видел',
  'library.expand': 'Показать, что внутри',
  'library.collapse': 'Скрыть, что внутри',
  'library.emptyTitle': 'Колод пока нет',
  'library.emptyBody':
    'Колоды появятся здесь, как только они будут. Создание колод появится на шестом этапе.',
  'library.readOnly': 'Пока только чтение. Создание и перенос колод появятся на шестом этапе.',

  'settings.title': 'Настройки',
  'settings.appearance': 'Внешний вид',
  'settings.theme': 'Тема',
  'settings.theme.system': 'Системная',
  'settings.theme.light': 'Светлая',
  'settings.theme.dark': 'Тёмная',
  'settings.language': 'Язык',
  'settings.glass': 'Жидкое стекло',
  'settings.glass.off': 'Выключить',
  'settings.glass.subtle': 'Умеренно',
  'settings.glass.full': 'Максимум',
  'settings.glassScope': 'Где применять',
  'settings.glassScope.floating': 'Только панели',
  'settings.glassScope.all': 'Панели и карточки',
  'settings.glassScopeOff': 'Пока стекло выключено, применять нечего.',
  'settings.glassCapped.motion':
    'Система просит меньше движения, поэтому панели идут на «Умеренно».',
  'settings.glassCapped.memory':
    'Устройство сообщает о малом объёме памяти, поэтому панели идут на «Умеренно».',
  'settings.glassCapped.frames':
    'Прокрутка здесь упала ниже 55 кадров в секунду, и панели убавились сами. Перезагрузи страницу, чтобы снова попробовать максимум.',
  'settings.motion': 'Анимации',
  'settings.motion.system': 'Как в системе',
  'settings.motion.reduce': 'Выключить',
  'settings.security': 'Безопасность',
  'settings.changePassword': 'Сменить пароль',
  'settings.currentPassword': 'Текущий пароль',
  'settings.newPassword': 'Новый пароль',
  'settings.passwordChanged': 'Пароль изменён. Везде остальном выполнен выход.',
  'settings.account': 'Аккаунт',
  'settings.deleteAccount': 'Удалить аккаунт',
  'settings.deleteAccountWarning':
    'При удалении аккаунта все колоды, карточки, история повторений и прогресс удаляются безвозвратно.',
  'settings.deleteAccountCodeHint': 'Двухфакторная аутентификация включена, поэтому нужен ещё код из приложения.',
  'settings.deleted': 'Аккаунт закрыт.',

  'error.not_authenticated': 'Войди, чтобы продолжить.',
  'error.not_allowed': 'Это действие отклонено. Обнови страницу и попробуй ещё раз.',
  'error.not_found': 'Этого здесь нет.',
  'error.invalid_request': 'В запросе что-то не так.',
  'error.name_taken': 'Такое имя здесь уже занято.',
  'error.deck_cycle': 'Колоду нельзя переместить внутрь самой себя.',
  'error.unknown_note_type': 'Такого типа заметки не существует.',
  'error.invalid_note_fields': 'Эти поля не подходят к типу заметки.',
  'error.rate_limited': 'Слишком много попыток. Подожди {seconds} секунд.',
  'error.registration_closed':
    'Регистрация сейчас закрыта. Если аккаунт уже есть, войти по-прежнему можно.',
  'error.weak_password': 'Выбери пароль длиннее или менее распространённый.',
  'error.email_taken': 'У этого адреса уже есть аккаунт.',
  'error.invalid_credentials': 'Эта почта и этот пароль не подходят друг к другу.',
  'error.invalid_recovery_code': 'Код неверный или уже использован.',
  'error.no_recovery_codes': 'На этом аккаунте не осталось кодов восстановления.',
  'error.password_change_required': 'Задай новый пароль, чтобы закончить вход.',
  'error.email_not_verified': 'Сначала подтверди адрес почты.',
  'error.two_factor_required': 'Введи код из приложения-аутентификатора.',
  'error.invalid_two_factor_code': 'Код неверный.',
  'error.two_factor_code_reused': 'Этот код уже использован. Дождитесь следующего.',
  'error.two_factor_unavailable': '2FA на этом аккаунте не настроена.',
  'error.invalid_token': 'Эта ссылка больше не действует. Запроси новую.',
  'error.direction_unavailable': 'Это направление карточки недоступно.',
  'error.sync_rejected': 'Эти изменения не удалось сохранить. Они остались на устройстве.',
  'error.service_unavailable': 'Сервер не отвечает. Работа сохранена на устройстве.',
  'error.network_unreachable':
    'Устройство не может связаться с сервером. Проверь соединение и попробуй ещё раз. Работа сохранена здесь.',
  'error.untrusted_origin':
    'Сервер не знает этот веб-адрес. Открой приложение по его обычному адресу и войди там.',
  'error.unexpected': 'Что-то пошло не так. Попробуй ещё раз.',
  'error.internal_error':
    'Что-то сломалось на нашей стороне. Попробуй ещё раз, а если повторится, назови этот номер: {correlationId}',
};

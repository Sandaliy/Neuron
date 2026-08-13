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
  'auth.password.tooCommon': 'Такой пароль подбирают первым. Выберите другой.',
  'auth.password.hint': 'Не меньше 10 символов. Длина важнее спецсимволов.',
  'auth.password.show': 'Показать пароль',
  'auth.password.hide': 'Скрыть пароль',

  'auth.signIn.title': 'Вход',
  'auth.signIn.submit': 'Войти',
  'auth.signIn.failed': 'Эта почта и этот пароль не подходят друг к другу.',
  'auth.signIn.forgot': 'Забыли пароль?',

  'auth.recoveryCodes.title': 'Ваши коды восстановления',
  'auth.recoveryCodes.warning':
    'Любой, у кого есть один из этих кодов, войдёт в ваш аккаунт без пароля. Храните их так же, как сам пароль: на бумаге в закрытом ящике или в менеджере паролей. Показать их ещё раз мы не сможем.',
  'auth.recoveryCodes.subtitle':
    'Десять кодов. Каждый работает один раз. Это единственный способ вернуться в аккаунт, если вы забудете пароль.',
  'auth.recoveryCodes.copy': 'Скопировать коды',
  'auth.recoveryCodes.copied': 'Скопировано',
  'auth.recoveryCodes.download': 'Скачать коды',
  'auth.recoveryCodes.confirm': 'Я их сохранил',
  'auth.recoveryCodes.remaining': 'Осталось кодов восстановления: {count}',
  'auth.recoveryCodes.low': 'Осталось всего {count} кодов восстановления. Выпустите новые.',
  'auth.recoveryCodes.none':
    'Кодов восстановления не осталось. Выпустите новые сейчас, пока помните пароль.',
  'auth.recoveryCodes.regenerate': 'Выпустить новые коды',
  'auth.recoveryCodes.regenerateWarning':
    'Это заменит все ваши коды. Старые перестанут работать сразу же.',

  'auth.recovery.title': 'Вход по коду восстановления',
  'auth.recovery.hint': 'Введите один из кодов, сохранённых при создании аккаунта.',
  'auth.recovery.invalid': 'Код неверный или уже использован.',
  'auth.recovery.exhausted':
    'Все коды восстановления этого аккаунта использованы. Напишите нам, чтобы сбросить пароль вручную.',
  'auth.recovery.setPassword': 'Придумайте новый пароль',
  'auth.recovery.setPasswordHint': 'Код израсходован. Задайте новый пароль, чтобы закончить вход.',
  'auth.recovery.signedOutElsewhere': 'На всех остальных устройствах выполнен выход.',

  'auth.twoFactor.title': 'Вход в два шага',
  'auth.twoFactor.subtitle':
    'По желанию. Добавляет к каждому входу шестизначный код из приложения на телефоне.',
  'auth.twoFactor.enable': 'Включить',
  'auth.twoFactor.disable': 'Выключить',
  'auth.twoFactor.scan': 'Отсканируйте это приложением-аутентификатором.',
  'auth.twoFactor.confirmHint':
    'Введите код, который показывает приложение. Пока вы этого не сделали, вход в два шага не включён.',
  'auth.twoFactor.codeLabel': 'Шестизначный код',
  'auth.twoFactor.invalid': 'Код неверный.',
  'auth.twoFactor.reused': 'Этот код уже использован. Дождитесь следующего.',
  'auth.twoFactor.unavailable': 'Вход в два шага на этом аккаунте не настроен.',
  'auth.twoFactor.enabled': 'Вход в два шага включён.',
  'auth.twoFactor.disabled': 'Вход в два шага выключен.',
  'auth.twoFactor.recoveryCodes.warning':
    'Эти десять кодов не связаны с кодами восстановления аккаунта и нужны для одного: войти, когда телефона под рукой больше нет. Сохраните их сейчас. Без них потерянный телефон означает потерянный аккаунт.',
  'auth.twoFactor.recoveryCodes.title': 'Коды на случай потери телефона',

  'auth.email.verifyTitle': 'Подтвердите почту',
  'auth.email.verifySent': 'Если у этого адреса есть аккаунт, письмо уже в пути.',
  'auth.email.verifyRequired': 'Подтвердите адрес почты, чтобы начать пользоваться приложением.',
  'auth.email.resend': 'Отправить ещё раз',
  'auth.email.verified': 'Почта подтверждена.',
  'auth.email.invalidToken': 'Эта ссылка больше не действует. Запросите новую.',

  'auth.reset.title': 'Сброс пароля',
  'auth.reset.sent': 'Если у этого адреса есть аккаунт, письмо уже в пути.',
  'auth.reset.done': 'Пароль изменён. На всех остальных устройствах выполнен выход.',

  'app.name': 'Neuron',
  'app.tagline': 'Интервальные повторения, которые планируют время, а не количество карточек',

  'nav.today': 'Сегодня',
  'nav.library': 'Библиотека',
  'nav.settings': 'Настройки',

  'common.cancel': 'Отмена',
  'common.continue': 'Продолжить',
  'common.save': 'Сохранить',
  'common.retry': 'Попробовать ещё раз',
  'common.loading': 'Загрузка',
  'common.signOut': 'Выйти',

  'auth.email.label': 'Почта',
  'auth.signIn.noAccount': 'Аккаунта ещё нет? Создайте.',
  'auth.signIn.recover': 'Войти по коду восстановления',
  'auth.register.haveAccount': 'Аккаунт уже есть? Войдите.',
  'auth.recoveryCodes.fileName': 'neuron-recovery-codes.txt',
  'auth.twoFactor.secretLabel': 'Не получается отсканировать? Введите это в приложение вручную.',
  'auth.twoFactor.password': 'Ваш пароль',
  'auth.twoFactor.passwordHint': 'Спрашиваем потому, что при включении выдаётся новая пачка кодов.',

  'today.title': 'Сегодня',
  'today.waiting': 'Карточек к повторению: {count}',
  'today.estimate': 'Примерно {minutes} минут',
  'today.estimateHint':
    'Посчитано по обычному времени ответа. Станет настоящим измерением, когда наберётся несколько дней ответов.',
  'today.study': 'Учить',
  'today.studyLater': 'Экран занятия ещё не готов. Он появится на седьмом этапе.',
  'today.emptyTitle': 'Ничего не ждёт',
  'today.emptyBody': 'Карточки появятся здесь в тот день, когда придёт их черёд.',

  'library.title': 'Библиотека',
  'library.dueLabel': 'Карточек к повторению',
  'library.newLabel': 'Карточек, которых вы ещё не видели',
  'library.expand': 'Показать, что внутри',
  'library.collapse': 'Скрыть, что внутри',
  'library.emptyTitle': 'Колод пока нет',
  'library.emptyBody':
    'Колоды появятся здесь, как только они будут. Создание колод появится на шестом этапе.',
  'library.readOnly': 'Пока только чтение. Создание и перенос колод появятся на шестом этапе.',

  'settings.title': 'Настройки',
  'settings.appearance': 'Внешний вид',
  'settings.theme': 'Тема',
  'settings.theme.system': 'Как в системе',
  'settings.theme.light': 'Светлая',
  'settings.theme.dark': 'Тёмная',
  'settings.language': 'Язык',
  'settings.security': 'Безопасность',
  'settings.changePassword': 'Сменить пароль',
  'settings.currentPassword': 'Текущий пароль',
  'settings.newPassword': 'Новый пароль',
  'settings.passwordChanged': 'Пароль изменён. Везде остальном выполнен выход.',
  'settings.account': 'Аккаунт',
  'settings.deleteAccount': 'Удалить аккаунт',
  'settings.deleteAccountWarning':
    'Аккаунт закроется, а вместе с ним уйдут колоды, заметки и вся история повторений. Через тридцать дней строки стираются окончательно, и изнутри приложения это уже не остановить.',
  'settings.deleteAccountConfirm': 'Наберите фразу ниже, чтобы подтвердить',
  'settings.deleteAccountPhrase': 'delete my account',
  'settings.deleted': 'Аккаунт закрыт.',

  'error.not_authenticated': 'Войдите, чтобы продолжить.',
  'error.not_allowed': 'Это действие недоступно.',
  'error.not_found': 'Этого здесь нет.',
  'error.invalid_request': 'В запросе что-то не так.',
  'error.name_taken': 'Такое имя здесь уже занято.',
  'error.deck_cycle': 'Колоду нельзя переместить внутрь самой себя.',
  'error.unknown_note_type': 'Такого типа заметки не существует.',
  'error.invalid_note_fields': 'Эти поля не подходят к типу заметки.',
  'error.rate_limited': 'Слишком много попыток. Подождите {seconds} секунд.',
  'error.registration_closed':
    'Регистрация сейчас закрыта. Если аккаунт уже есть, войти по-прежнему можно.',
  'error.weak_password': 'Выберите пароль длиннее или менее распространённый.',
  'error.email_taken': 'У этого адреса уже есть аккаунт.',
  'error.invalid_credentials': 'Эта почта и этот пароль не подходят друг к другу.',
  'error.invalid_recovery_code': 'Код неверный или уже использован.',
  'error.no_recovery_codes': 'На этом аккаунте не осталось кодов восстановления.',
  'error.password_change_required': 'Задайте новый пароль, чтобы закончить вход.',
  'error.email_not_verified': 'Сначала подтвердите адрес почты.',
  'error.two_factor_required': 'Введите код из приложения-аутентификатора.',
  'error.invalid_two_factor_code': 'Код неверный.',
  'error.two_factor_code_reused': 'Этот код уже использован. Дождитесь следующего.',
  'error.two_factor_unavailable': 'Вход в два шага на этом аккаунте не настроен.',
  'error.invalid_token': 'Эта ссылка больше не действует. Запросите новую.',
  'error.direction_unavailable': 'Это направление карточки недоступно.',
  'error.sync_rejected': 'Эти изменения не удалось сохранить. Они остались на устройстве.',
  'error.service_unavailable': 'Сервер не отвечает. Работа сохранена на устройстве.',
  'error.internal_error': 'Что-то сломалось на нашей стороне. Номер обращения: {correlationId}',
};

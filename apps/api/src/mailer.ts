import type { Env } from './env.js';

/**
 * The seam where a mail provider will go.
 *
 * Nothing is sent today. There is no domain, and a free mail service will only
 * deliver to arbitrary addresses from a verified one. What exists instead is
 * the shape: an interface with one method, one implementation that writes to
 * the log, and a variable that chooses between them. Adding Resend later means
 * a second implementation and a new value for `MAILER`, not surgery on the
 * places that send mail.
 *
 * The reason for building it now rather than then: the verification and reset
 * flows are written and tested against `LogMailer`, reading the token back out
 * of it. On the day the domain arrives, the code path being switched on has
 * already run thousands of times.
 */

/** One message, as anything that sends mail describes it. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. There is no template layer and nothing needs one yet. */
  readonly body: string;
}

export interface Mailer {
  /**
   * Sends one message, or does whatever this implementation does instead.
   *
   * @param message who it is for and what it says
   */
  send: (message: MailMessage) => Promise<void>;
}

/**
 * Writes the message to the server log and sends nothing.
 *
 * The whole address and the whole body, on purpose and only here. Everywhere
 * else in this project an email address in a log is a defect; this is the one
 * place whose entire job is that the message is visible, and it only ever runs
 * when there is no real sender configured. The moment `MAILER` names a
 * provider, nothing reaches the log at all.
 *
 * `sent` keeps what went through it, which is what lets a test read a
 * verification token out without a mail server.
 */
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);

    console.info(
      [
        '[mailer] no provider is configured, so nothing was sent.',
        `  to:      ${message.to}`,
        `  subject: ${message.subject}`,
        message.body
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      ].join('\n'),
    );

    return Promise.resolve();
  }

  /** The last message sent to one address, for the tests. */
  lastTo(address: string): MailMessage | undefined {
    return this.sent.findLast((message) => message.to === address.toLowerCase());
  }

  /** Forgets everything, so one test cannot read another test's message. */
  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Builds the mailer named by the environment.
 *
 * @param env the parsed environment
 * @returns the mailer the rest of the api sends through
 */
export function createMailer(env: Env): Mailer {
  switch (env.MAILER) {
    case 'log':
      return new LogMailer();
  }
}

/**
 * The one link in a verification or reset message.
 *
 * Built here so both messages agree on where the client picks the token up,
 * and so the token appears in exactly one place per message, which is what the
 * tests read.
 *
 * @param origin where the web app is served from
 * @param path the screen that handles it
 * @param token the single use token
 */
export function actionLink(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);

  url.searchParams.set('token', token);

  return url.toString();
}

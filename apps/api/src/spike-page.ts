/*
 * TEMPORARY. DELETE IN PHASE 5.
 *
 * A throwaway page for checking the stack in a browser instead of with curl:
 * sign up, sign in, and read the session back. It is not part of the product,
 * it has no design and no translations, and the real web app replaces it.
 *
 * The markup lives in a string rather than in an .html file so that the
 * deployed function carries it without any file bundling rules.
 */

export const spikePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Neuron stack check</title>
    <style>
      body {
        font-family: ui-monospace, monospace;
        max-width: 40rem;
        margin: 2rem auto;
        padding: 0 1rem;
        line-height: 1.5;
        background: #0b0b0c;
        color: #ececee;
      }
      h1 { font-size: 1.1rem; }
      label { display: block; margin-top: 0.75rem; }
      input {
        width: 100%;
        padding: 0.5rem;
        margin-top: 0.25rem;
        background: #131316;
        color: #ececee;
        border: 1px solid #26262b;
        border-radius: 6px;
      }
      .buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
      button {
        padding: 0.6rem 0.9rem;
        min-height: 44px;
        background: #1a1a1e;
        color: #ececee;
        border: 1px solid #26262b;
        border-radius: 6px;
        cursor: pointer;
      }
      button:focus-visible { outline: 2px solid #4d7fe8; outline-offset: 2px; }
      pre {
        background: #131316;
        border: 1px solid #26262b;
        border-radius: 6px;
        padding: 0.75rem;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <h1>Neuron stack check</h1>
    <p>Temporary page. It proves that the server, the database and sign in work together.</p>

    <label>
      Email
      <input id="email" type="email" autocomplete="username" value="test@example.com" />
    </label>
    <label>
      Password
      <input id="password" type="password" autocomplete="current-password" value="correct horse battery staple" />
    </label>

    <div class="buttons">
      <button id="sign-up" type="button">Sign up</button>
      <button id="sign-in" type="button">Sign in</button>
      <button id="me" type="button">Call /me</button>
      <button id="sign-out" type="button">Sign out</button>
    </div>

    <pre id="output">Nothing yet.</pre>

    <script>
      const output = document.getElementById('output');

      function show(label, status, body) {
        output.textContent = label + '  ->  HTTP ' + status + '\\n\\n' + body;
      }

      async function call(label, path, options) {
        output.textContent = label + ' ...';
        try {
          const response = await fetch(path, { credentials: 'include', ...options });
          const text = await response.text();
          let body = text;
          try {
            body = JSON.stringify(JSON.parse(text), null, 2);
          } catch (error) {
            void error;
          }
          show(label, response.status, body);
        } catch (error) {
          output.textContent = label + ' failed to reach the server: ' + String(error);
        }
      }

      function credentials() {
        return {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        };
      }

      const json = (body) => ({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      document.getElementById('sign-up').addEventListener('click', () => {
        const { email, password } = credentials();
        call('sign up', '/api/auth/sign-up/email', json({ email, password, name: email }));
      });

      document.getElementById('sign-in').addEventListener('click', () => {
        call('sign in', '/api/auth/sign-in/email', json(credentials()));
      });

      document.getElementById('me').addEventListener('click', () => {
        call('call /me', '/me', { method: 'GET' });
      });

      document.getElementById('sign-out').addEventListener('click', () => {
        call('sign out', '/api/auth/sign-out', json({}));
      });
    </script>
  </body>
</html>
`;

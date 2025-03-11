const SECURE_ORIGIN = 'https://secure.soundcloud.com';
let previousUser;

const sel = (selector) => document.querySelector(selector);

const getSession = (username) => new Promise((resolve) => {
  chrome.storage.local.get('sc-accounts', (result) => {
    const accounts = result['sc-accounts'] || {};
    resolve(accounts[username]);
  });
});

const getAllSessions = () => new Promise((resolve) => {
  chrome.storage.local.get('sc-accounts', (result) => {
    resolve(result['sc-accounts'] || {});
  });
});

const getCurrentUser = () => {
  if (sel('.header__userNavUsernameButton') !== null) {
    return new URL(sel('.header__userNavUsernameButton').href).pathname.substr(
      1,
    );
  }

  return false;
};

const saveSession = async (username, sessionData) => {
  const accounts = await getAllSessions();
  const storedCookie = Object.keys(accounts).find(
    (user) => accounts[user].cookie === sessionData.cookie,
  );

  if (storedCookie && username !== storedCookie) delete accounts[storedCookie];
  accounts[username] = sessionData;

  chrome.storage.local.set({ 'sc-accounts': accounts });
};

const deleteSession = async (username) => {
  const accounts = await getAllSessions();
  delete accounts[username];
  chrome.storage.local.set({ 'sc-accounts': accounts });
};

const saveCurrentSession = async () => {
  const username = getCurrentUser();
  if (username === false) return;

  const sessionData = (await getSession(username)) || {};

  sessionData.notifyState = localStorage.getItem('V2::local::notify');
  await saveSession(username, sessionData);

  if (previousUser === username || !username) return;
  previousUser = username;

  chrome.runtime.sendMessage(
    { method: 'getCookie', data: { name: 'oauth_token' } },
    async (data) => {
      const cookie = data ? data.value : null;
      if (!cookie) return;

      sessionData.cookie = cookie;
      await saveSession(username, sessionData);
    },
  );
};

const switchSession = async (user) => {
  await saveCurrentSession();

  const sessionData = await getSession(user);
  if (sessionData.notifyState != null) {
    localStorage.setItem('V2::local::notify', sessionData.notifyState);
  }

  chrome.runtime.sendMessage(
    {
      method: 'setCookie',
      data: { name: 'oauth_token', value: sessionData.cookie },
    },
    () => {
      location.reload();
    },
  );
};

const forceLogout = async () => {
  await saveCurrentSession();
  chrome.runtime.sendMessage(
    { method: 'removeCookie', data: { name: 'oauth_token' } },
    () => {
      chrome.runtime.sendMessage({ method: 'forceLogout' }, () => {
        window.location = 'https://soundcloud.com/signin';
      });
    },
  );
};

const injectSwitcher = async () => {
  const accounts = await getAllSessions();

  if (Object.keys(accounts).length > 0) {
    const list = document.createElement('ul');
    list.setAttribute('class', 'profileMenu__list sc-list-nostyle');

    const addBtn = document.createElement('li');
    addBtn.setAttribute('class', 'headerMenu__list');
    const addLink = document.createElement('a');
    addLink.setAttribute('class', 'headerMenu__link profileMenu__profile');
    addLink.innerText = 'Add Account';
    addLink.id = 'add-account';
    addLink.href = '#';

    addBtn.onclick = () => {
      forceLogout();
    };

    addBtn.appendChild(addLink);
    list.appendChild(addBtn);

    Object.keys(accounts).forEach((account) => {
      if (account === getCurrentUser()) return;

      const wrapper = document.createElement('div');
      const li = document.createElement('li');
      const link = document.createElement('a');

      li.setAttribute('class', 'headerMenu__item');
      link.setAttribute('class', 'headerMenu__link profileMenu__profile');
      link.innerText = account;
      link.id = 'switch-account';
      link.dataset.user = account;
      link.href = '#';
      link.title = account;
      link.style.display = 'inline-block';
      link.style.width = '50%';
      link.style.textOverflow = 'ellipsis';
      link.style.overflow = 'hidden';
      link.style.verticalAlign = 'middle';

      const delBtn = document.createElement('a');

      delBtn.setAttribute('class', 'headerMenu__profile');
      delBtn.innerHTML = '&times;';
      delBtn.id = 'delete-account';
      delBtn.dataset.user = account;
      delBtn.href = '#';
      delBtn.style.padding = '5px';
      delBtn.style.display = 'inline-block';
      delBtn.style.verticalAlign = 'middle';

      delBtn.onclick = async (event) => {
        if (
          // eslint-disable-next-line no-alert
          confirm(
            `Are you sure you want to remove the '${event.target.dataset.user}' account?`,
          )
        ) {
          // eslint-disable-line
          await deleteSession(event.target.dataset.user);
          event.target.parentNode.parentNode.removeChild(
            event.target.parentNode,
          );
        }
      };

      link.onclick = (event) => {
        switchSession(event.target.dataset.user);
      };

      wrapper.appendChild(link);
      wrapper.appendChild(delBtn);
      li.appendChild(wrapper);
      list.appendChild(li);
    });
    if (sel('.profileMenu')) sel('.profileMenu').appendChild(list);
  }
};

const passSessions = async (element) => {
  const accounts = await getAllSessions();
  element.contentWindow.postMessage(
    ['_scam_sessions', accounts],
    SECURE_ORIGIN,
  );
};

const menuObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    const addedNodes = Array.from(mutation.addedNodes);
    if (
      addedNodes.includes(sel('.dropdownMenu'))
      || addedNodes.includes(sel('.headerMenu__list'))
    ) {
      injectSwitcher();
    }
    if (
      mutation.target.classList
      && [...mutation.target.classList].includes('header__userNavUsernameButton')
    ) {
      saveCurrentSession();
    }

    addedNodes.forEach((node) => {
      if (
        node.querySelector
        && node.querySelector('.webAuthContainer iframe')
      ) {
        const iframe = node.querySelector('.webAuthContainer iframe');
        iframe.onload = () => {
          passSessions(iframe);
        };
      }
    });
  }
});

window.addEventListener(
  'message',
  (message) => {
    const { origin, data } = message;
    if (origin !== SECURE_ORIGIN) return;

    if (data === '_scam_reload') {
      window.location.reload();
    }
  },
  false,
);

const init = async () => {
  // Migrate from localStorage to chrome.storage if needed
  if (localStorage.hasOwnProperty('sc-accounts')) {
    try {
      const sessions = JSON.parse(localStorage.getItem('sc-accounts')) || {};
      Object.keys(sessions).forEach((username) => {
        if (typeof sessions[username] === 'string') sessions[username] = { cookie: sessions[username] };
      });

      chrome.storage.local.set({ 'sc-accounts': sessions }, () => {
        localStorage.removeItem('sc-accounts');
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error migrating session data:', e);
    }
  }

  const observerOptions = { childList: true, subtree: true };
  menuObserver.observe(document.body, observerOptions);
  saveCurrentSession();
};

init();

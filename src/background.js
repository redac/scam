// Self-activate service worker to keep it running when first installed
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Make sure the service worker activates immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.method === 'forceLogout') {
    chrome.cookies
      .remove({
        url: 'https://api-auth.soundcloud.com/connect/',
        name: '_soundcloud_session',
      })
      .then(() => sendResponse(true));
  } else if (request.method === 'getCookie') {
    chrome.cookies
      .get({
        url: 'https://soundcloud.com/',
        name: request.data.name,
      })
      .then((cookie) => sendResponse(cookie));
  } else if (request.method === 'setCookie') {
    chrome.cookies
      .set({
        url: 'https://soundcloud.com/',
        name: request.data.name,
        value: request.data.value,
        secure: true,
        // expiry 1 year from now
        expirationDate: Math.floor(+new Date(+new Date() + 31536e6) / 1000),
      })
      .then((cookie) => sendResponse(cookie));
  } else if (request.method === 'removeCookie') {
    chrome.cookies
      .remove({
        url: 'https://soundcloud.com/',
        name: request.data.name,
      })
      .then((details) => sendResponse(details));
  } else if (request.method === 'validateCookie') {
    fetch('https://api-auth.soundcloud.com/connect/session', {
      method: 'POST',
      body: JSON.stringify({ session: { access_token: request.data.cookie } }),
    })
      .then((response) => {
        sendResponse(response.status === 200);
      })
      .catch(() => {
        sendResponse(false);
      });
  } else if (request.method === 'refreshCookie') {
    const fetchNewCookie = () => {
      fetch('https://api-auth.soundcloud.com/connect/session/token', {
        method: 'POST',
        body: 'null',
      })
        .then((response) => {
          if (response.status === 200) {
            return response.json();
          }
          throw new Error('Failed to refresh cookie');
        })
        .then((data) => {
          sendResponse(data.session.access_token);
        })
        .catch(() => {
          sendResponse(null);
        });
    };

    if (request.data && request.data.cookie) {
      chrome.cookies
        .set({
          url: 'https://api-auth.soundcloud.com/connect/',
          name: '_soundcloud_session',
          value: request.data.cookie,
          secure: true,
          sameSite: 'no_restriction',
        })
        .then(() => fetchNewCookie());
    } else {
      fetchNewCookie();
    }
  }

  return true;
});

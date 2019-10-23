const URL = require('url');
const UTIL = require('util');
const HTTPS = require('https');

const parseSetCookies = (headers) => {
  const cookies_raw = headers['set-cookie'].map(a => a.split(';')[0]);
  const cookies = new Map();
  for(const c of cookies_raw) cookies.set(c.split('=')[0], c.split('=')[1]);
  return cookies;
}

// TODO: implement error handling
exports.getPage = (link, cookie) => new Promise(resolve => {
  const req = HTTPS.request(link, {headers: {cookie}}, resp => {
    console.log('getPage', {statusCode: resp.statusCode, headers: resp.headers, link});
    const cookies = parseSetCookies(resp.headers);

    const body = [];
    resp.on('data', chunk => body.push(chunk));
    resp.on('end', () => {
      return resolve([Buffer.concat(body), cookies, resp.statusCode]);
    });
  });
  req.end();
});

// TODO: implement error handling
exports.postPage = (link, cookie, data) => new Promise(resolve => {
  const req = HTTPS.request(link, {method: 'POST', headers: {cookie}}, resp => {
    console.log('postPage', {statusCode: resp.statusCode, headers: resp.headers, link});
    const cookies = parseSetCookies(resp.headers);

    const body = [];
    resp.on('data', chunk => body.push(chunk));
    resp.on('end', () => {
      return resolve([Buffer.concat(body), cookies, resp.statusCode]);
    });
  });
  if(data) req.write(data);
  req.end();
});

exports.stringifyCookie = (cookie) => {
  if(!UTIL.types.isMap(cookie)) throw new Error('expecting a Map');
  let resp = '';
  for(const [key, val] of cookie) {
    resp += `${key}=${val}; `;
  }
  return resp.trim();
}

exports.sleep = (time) => new Promise(resolve => {
  setTimeout(resolve, time);
});

const URL = require('url');
const QS = require('querystring');
const Util = require('./util.js');
const CHEERIO = require('cheerio');
const Captcha = require('./captcha.js');

const { captchaToken, username, password } = require('./credentials.json')

const ROOT_PATH = 'https://www.houseofgord.com/';
const QUERY_PAGE_DELAY = 2 * 60 * 1000;

class HOG {
  constructor(CAPTCHA_KEY) {
    this.COOKIE = new Map();
    this.COOKIE.set('legal_accepted2', 'yes');

    this.CaptchaSolver = new Captcha(CAPTCHA_KEY);
    this.meta = null;
    this.shoots = [];
  }
  login(username, pw) {
    return this._login(username, pw, null, 3);
  }
  _login(uname, pw, prevTask, retrys) {
    return new Promise(async (resolve, reject) => {
      if(retrys===0) return reject(new Error('to many retrys'));
      // get login page
      let [loginBody, loginCookie, loginStatusCode] = await Util.getPage(ROOT_PATH + 'sessions/login', Util.stringifyCookie(this.COOKIE));
      if(loginStatusCode !== 200) return reject(new Error(`invalid statusCode: ${loginStatusCode}`));
      // parse the data we need from login page
      if(loginBody.includes('The username and password combination you entered was incorrect')) return reject(new Error('invalid login credentials'));
      if(loginBody.includes('The code you entered did not match the one that was displayed') && prevTask) prevTask.markInvalid();
      this.COOKIE.set('_hofg_session_v2', loginCookie.get('_hofg_session_v2'));
      const authenticity_token = loginBody.toString().match(/<meta name="csrf-token" content="([^"]+)" \/>/)[1];
      // pull the captcha png
      let [captcha, captchaCookie, captchaStatusCode] = await Util.getPage(ROOT_PATH + 'sessions/display_captcha', Util.stringifyCookie(this.COOKIE));
      if(captchaStatusCode !== 200) return reject(new Error(`invalid statusCode: ${captchaStatusCode}`));
      // get the captcha solved
      const task = this.CaptchaSolver.resolveImage(captcha);
      task.on('error', err => reject(err));
      task.on('finished', async (solution, additional) => {
        // captcha resolved
        console.log('finished resolving captcha', {solution, additional});
        // try authentication with captcha & login credentials
        let [body, authCookie] = await Util.postPage(ROOT_PATH + 'sessions/authenticate', Util.stringifyCookie(this.COOKIE), 'utf8=%E2%9C%93&commit=Login&' + QS.encode({
          authenticity_token: authenticity_token,
          login: uname,
          password: pw,
          captcha: solution,
        }));
        if(authCookie.has('user_token2')) {
          this.COOKIE.set('user_token2', authCookie.get('user_token2'));
          return resolve();
        }
        this._login(uname, pw, task, retrys-1).then(resolve).catch(reject);
      });
    });
  }

  query() {
    if(!this.meta) return this.queryMeta().then(() => this.query())
    return new Promise((resolve, reject) => {
      Promise.all(
        Array(this.meta.pages).fill(null)
          .map((item, index) => index)
          .filter(i => !this.shoots.some(c => c.page === i))
          .map(i => this._queryPage(i, true))
      )
      .then(() => resolve(this.shoots))
      .catch(reject);
    });
  }
  _queryPage(pageNum, randomDelay=false) {
    return new Promise(async (resolve, reject) => {
      // randomize the requests in a timewindow of 2 Minutes
      if(randomDelay) await Util.sleep(QUERY_PAGE_DELAY * Math.random());
      let [page, , pageStatus] = await Util.getPage(ROOT_PATH + `?page=${pageNum+1}`, Util.stringifyCookie(this.COOKIE));
      if(pageStatus !== 200) return reject(new Error(`invalid statusCode: ${pageStatus}`));

      const $ = CHEERIO.load(page);
      const content = this._parseShoots($, pageNum);
      this.shoots.push(...content);
      resolve(content);
    })
  }
  queryMeta() {
    return new Promise(async (resolve, reject) => {
      let [page, , pageStatus] = await Util.getPage(ROOT_PATH, Util.stringifyCookie(this.COOKIE));
      if(pageStatus !== 200) return reject(new Error(`invalid statusCode: ${pageStatus}`));

      const $ = CHEERIO.load(page);
      this.meta = {
        categories: this._getCategories($),
        pages: this._getPageCount($),
      }
      this.shoots.push(...this._parseShoots($, 0));
      resolve(this.meta);
    });
  }

  _parseShoots($, pageNum) {
    const listings = $('.preview_listing');
    const parsed = [];
    listings.each(function(index) {
      const listing = $(this);
      const item = {
        page: pageNum,
        item: index,
        title: $('.preview_title', this).text().trim(),
        ref: $('.preview_title', this).attr('href'),
        description: $('.preview_description', this).text().trim() || null,
        media: [],
        meta: [],
      };
      $('.preview_feature_date', this).children('a').each(function() {
        const entry = $(this)
        item.media.push({
          ref: entry.attr('href'),
          type: entry.text().split('added')[0].trim(),
          date: entry.text().split('added')[1].trim(),
        })
      })
      $('.preview_facets_listing', this).children('a').each(function() {
        item.meta.push($(this).text().trim())
      });
      parsed.push(item);
    })
    return parsed;
  }

  _parseShootVideo(ref) {
    return new Promise(async (resolve, reject) => {
      let [page, , pageStatus] = await Util.getPage(URL.resolve(ROOT_PATH, ref), Util.stringifyCookie(this.COOKIE));
      if(pageStatus !== 200) return reject(new Error(`invalid statusCode: ${pageStatus}`));

      const $ = CHEERIO.load(page);
      const vids = [];
      $('.element_video').each(function() {
        const name = $('font', this).text().trim();
        const quality = [];
        $('.media_multifile_size', this).each(function() {
          const parts = $('a', this).text().match(/([^()]*)\(([^()]*)/);
          quality.push({
            name: parts[1].trim(),
            size: parts[2].trim(),
            ref: $('a', this).attr('href'),
          });
        });
        vids.push({
          name: name,
          quality: quality,
          default: $('.thumbnailed_media', this).attr('href'),
        });
      });
      resolve(vids);
    });
  }

  _getPageCount($) {
    return Number($('.last', '#sidebar_pagination_top').text().trim());
  }

  _getCategories($) {
    const categories = new Map();
    // for each categorie
    $('.facet_group_hidden').each(function() {
      // parse label
      const labelDiv = $('.facet_group_label', this);
      labelDiv.children().remove();
      const label = labelDiv.text().trim();
      // parse items
      const items = [];
      $('.facet', this).children().each(function(index) {
        items[index] = $(this).text().trim();
      });
      categories.set(label, items);
    });
    return categories
  }
}
module.exports = HOG;

const main = async () => {
  const h = new HOG(captchaToken);
  h.login(username, password).then(() => {
    console.log('logged in', h.COOKIE);
    return h.queryMeta();
  }).then(() => {
    console.log('received meta: ', h.meta);
    return h.query();
  }).then(shots => {
    console.log('received shots:', shots.length);
    const sources = shots[3].media.filter(a => a.type.toLowerCase().includes('video'));
    return h._parseShootVideo(sources[0].ref);
  }).then(refs => {
    console.log('received shoot media:', refs[0].quality);
  }).catch(console.error);
}
setImmediate(main);

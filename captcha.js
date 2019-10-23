// short wrapper to interact with https://anti-captcha.com/

// apidoc: https://anticaptcha.atlassian.net/wiki/spaces/API/pages/196635/Documentation+in+English
// list of errorIDs: https://anticaptcha.atlassian.net/wiki/spaces/API/pages/5079075/Errors

const HTTPS = require('https');
const URL = require('url');
const EventEmitter = require('events').EventEmitter;

const BASE_ENDPOINT = 'https://api.anti-captcha.com/'

class ImageCaptchaSolver {
  constructor(apiKey) {
    this.API_KEY = apiKey;
  }

  resolveImage(image) {
    const task = new Task(this, image);
    setImmediate(task.start.bind(task));
    return task;
  }

  resolveImagePromisified(image) {
    return new Promise((resolve, reject) => {
      const task = new Task(this, image);
      task.on('error', err => reject(err));
      task.on('finished', solution => resolve(solution));
      task.start();
    });
  }

  getBalance() {
    return new Promise((resolve, reject) => {
      getBalance(this.API_KEY).then(res => {
        if(res.errorId === 0) return resolve(res.balance);
        return reject(new Error('Failed: '+JSON.stringify(res)));
      }).catch(err => reject(err));
    });
  }
}

/**
 * events:
 * @starting - / - emitted when starting new task
 * @taskId - number:id - emitted when successfully received taskId from service
 * @error - error:error - emitted when sth went wrong
 * @checking - number:prevChecks - emitted when checking for a result
 * @finished - string:solution, object:additional - emitted when finished captcha resolving
 * @invalidating - / - called when the user calls invalidate on a task
 */
class Task extends EventEmitter {
  constructor(master, image) {
    super();
    this.taskId = null;
    this.master = master;
    if(!Buffer.isBuffer(image)) throw new Error('invalid image provided');
    this.image = image.toString('base64');

    this._checked = 0;
    this.response = null;
    this.error = null;
  }

  get finished() {
    return this.response !== null;
  }

  get failed() {
    return this.error !== null;
  }

  start() {
    this.emit('starting');
    createTask(this.master.API_KEY, this.image).then(id => {
      this.taskId = id;
      this.emit('taskId', id);
      setTimeout(this._check.bind(this), 10 * 1000);
    }).catch(err => {
      this.error = err;
      this.emit('error', err);
    });
  }

  // for manual (additional) checking
  check() {
    this._check(true);
  }

  _check(manual=false) {
    if(this.finished || this.failed) return;
    this.emit('checking', this._checked);
    getResult(this.master.API_KEY, this.taskId).then(res => {
      if(!manual) this._checked++;
      if(res.errorId !== 0) {
        this.error = res;
        this.emit('error', res);
        return;
      }
      if(res.status === 'ready') {
        this.response = res;
        this.emit('finished', res.solution.text, {
          cost: res.cost,
          createTime: res.createTime,
          endTime: res.endTime,
          tookTime: res.endTime-res.createTime,
          workers: res.solveCount
        });
        return;
      }
      else if(!manual && res.status === 'processing' && this._checked < 5) {
        return setTimeout(this._check.bind(this), 5 * 1000);
      }
      this.error = new Error('task timed out');
      this.emit('error', this.error);
    }).catch(err => {
      this.error = err;
      this.emit('error', err);
    });
  }

  markInvalid() {
    this.emit('invalidating');
    reportIncorrect(this.master.API_KEY, this.taskId);
  }
}

/*
* api interaction
*/

const apiRequest = (apiKey, endpoint, payload={}) => new Promise((resolve, reject) => {
  const req = HTTPS.request(BASE_ENDPOINT + endpoint, {
    method: 'POST'
  }, resp => {
    if(resp.statusCode !== 200) return reject(new Error('invalid statusCode: '+resp.statusCode));

    const body = [];
    resp.on('data', chunk => body.push(chunk))
    resp.on('end', () => {
      return resolve(JSON.parse(Buffer.concat(body).toString()));
    });
  });
  req.on('error', e => {
    return reject(e);
  })
  req.write(JSON.stringify(
    Object.assign({}, payload, {clientKey: apiKey})
  ));
  req.end();
});

const createTask = async (apiKey, image) => {
  return (await apiRequest(apiKey, 'createTask', {
    task: {
      type: "ImageToTextTask",
      body: image,
      phrase: false,
      case: false,
      numeric: 2,
      math: false,
      minLength: 5,
      maxLength: 5,
    }
  })).taskId;
}

const getResult = async (apiKey, taskId) => {
  return await apiRequest(apiKey, 'getTaskResult', {
    taskId: taskId,
  });
}

const getBalance = async (apiKey) => {
  return await apiRequest(apiKey, 'getBalance');
}

const reportIncorrect = async (apiKey, taskId) => {
  return await apiRequest(apiKey, 'reportIncorrectImageCaptcha', {
    taskId: taskId,
  });
}


/*
* export
*/

module.exports = ImageCaptchaSolver;

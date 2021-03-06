import Koa from 'koa';
import convert from 'koa-convert';
import webpack from 'webpack';
import historyApiFallback from 'koa-connect-history-api-fallback';
import serve from 'koa-static';
import proxy from 'koa-proxy';
import _debug from 'debug';
import webpackConfig from '../build/webpack.config';
import config from '../config';
import { Message } from '../src/util/Enum';
import webpackDevMiddleware from './middleware/webpack-dev';
import webpackHMRMiddleware from './middleware/webpack-hmr';
const debug = _debug('app:server');
const paths = config.utils_paths;
const app = new Koa();

// Enable koa-proxy if it has been enabled in the config.
if (config.proxy && config.proxy.enabled) {
  app.use(convert(proxy(config.proxy.options)));
}

// This rewrites all routes requests to the root /index.html file
// (ignoring file requests). If you want to implement isomorphic
// rendering, you'll want to remove this middleware.
app.use(convert(historyApiFallback({
  verbose: false,
})));

// ------------------------------------
// Apply Webpack HMR Middleware
// ------------------------------------
if (config.env === 'development') {
  const compiler = webpack(webpackConfig);

  // Enable webpack-dev and webpack-hot middleware
  const { publicPath } = webpackConfig.output;

  app.use(webpackDevMiddleware(compiler, publicPath));
  app.use(webpackHMRMiddleware(compiler));

  // Serve static assets from ~/src/static since Webpack is unaware of
  // these files. This middleware doesn't need to be enabled outside
  // of development since this directory will be copied into ~/dist
  // when the application is compiled.
  app.use(serve(paths.client('static')));
} else {
  debug(
    'Server is being run outside of live development mode, meaning it will ' +
    'only serve the compiled application bundle in ~/dist. Generally you ' +
    'do not need an application server for this and can instead use a web ' +
    'server such as nginx to serve your static files. See the "deployment" ' +
    'section in the README for more information on deployment strategies.'
  );

  // Serving ~/dist by default. Ideally these files should be served by
  // the web server and not the app server, but this helps to demo the
  // server in production.
  app.use(serve(paths.dist()));
}
const userMap = {};
const chatMap = {
  '第一个聊天室': {
    userNum: 0,
    icon: '/images/chat/1.png',
  }
};
const messageMap = {
  '第一个聊天室': [{
    username: '吕铭印',
    userId: '123',
    chatName: '第一个聊天室',
    message: '第一条信息',
    type: Message.NORMAL,
    time: Date.now(),
  }],
};
var server = require('http').createServer(app.callback());
var io = require('socket.io')(server);
io.on('connection', function (socket) {
  socket.emit('connected', {
    chatMap,
  });
  socket.on('login', function (data) {
    // 用户登录,根据id设置初始化信息
    userMap[socket.id] = {
      id: socket.id,
      username: data.username,
      currChat: '',
    };
    socket.emit('action', {
      type: 'LOGIN_IN',
      user: userMap[socket.id],
    });
  });

  socket.on('user join', function ({ chatName }) {
    // 用户进入聊天室,传入聊天室的名称,聊天室的名称是唯一的
    // 获取聊天室对象
    let chat = chatMap[chatName];
    // 获取用户对象
    const user = userMap[socket.id];
    if (user && user.currChat) {
      // 如果之前有加入聊天室,先离开
      let prevChat = chatMap[user.currChat];
      // 人数减1
      prevChat.userNum = prevChat.userNum - 1;
      socket.to(user.currChat).emit('action', {
        type: 'USER_LEFT',
        data: {
          chat: prevChat, user,
        },
      });
      // 离开
      socket.leave(user.currChat);
    }
    // 当前聊天室人数+1
    chat.userNum = chat.userNum + 1;
    // 给当前聊天室的人发送加入信息
    socket.to(chatName).emit('action', {
      type: 'USER_JOIN',
      data: {
        chat,
        user,
      },
    });
    user.currChat = chatName;
    // 当前socket加入到聊天室中
    socket.join(chatName);
    // 加入成功
    socket.emit('action', {
      type: 'JOIN_SUCCESS',
      data: {
        chat,
        user,
        chatName,
        messages: messageMap[chatName],
      },
    });
  });

  socket.on('create chat', function ({ chatName, icon }) {
    if (chatMap[chatName]) {
      socket.emit('action', {
        type: 'CREATE_CHAT_FAILED',
        message: '创建失败,已存在同名的聊天室。',
      });
    } else {
      chatMap[chatName] = {
        userNum: 0,
        icon,
      };
      messageMap[chatName] = [];
      socket.emit('action', {
        type: 'CREATE_CHAT_SUCCESS',
        data: {
          name: chatName,
          ...chatMap[chatName]
        },
      });
      socket.broadcast.emit('action', {
        type: 'CREATE_CHAT_SUCCESS',
        data: {
          name: chatName,
          ...chatMap[chatName]
        },
      });
    }
  });

  socket.on('new message', function ({ chatName, message }) {
    const user = userMap[socket.id];
    const chatMsg = messageMap[chatName];
    if (chatMap) {
      const msg = {
        username: user.username,
        userId: socket.id,
        message,
        chatName,
        type: Message.NORMAL,
        time: Date.now(),
      };
      chatMsg.push(msg);
      socket.to(chatName).emit('action', {
        type: 'NEW_MESSAGE',
        data: msg,
      });
    }
  });

  socket.on('loadChatInfo', function ({ chatName }) {
    if (chatName) {
      socket.emit('loadChatInfo', {
        messages: messageMap[chatName],
        chat: chatMap[chatName],
      });
    }
  });

  socket.on('disconnect', function () {
    // 如果之前有加入聊天室,先离开
    const user = userMap[socket.id];
    if (user && user.currChat) {
      // 离开
      let prevChat = chatMap[user.currChat];
      // 人数减1
      prevChat.userNum = prevChat.userNum - 1;
      socket.to(user.currChat).emit('user left', {
        user,
        chat: prevChat,
      });
      socket.leave(user.currChat);
    }
    userMap[socket.id] = undefined;
  });
});

export default server;

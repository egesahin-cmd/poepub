const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const MAX_ROOM_SIZE = 35;

function broadcastCount(room) {
  const count = rooms[room] ? rooms[room].length : 0;
  io.to(room).emit('room-count', { count });
}

io.on('connection', (socket) => {
  console.log(`+ ${socket.id}`);
  let currentRoom = null;

  socket.on('join', ({ room }) => {
    // Leave current room if switching rooms
    if (currentRoom && currentRoom !== room && rooms[currentRoom]) {
      rooms[currentRoom] = rooms[currentRoom].filter(id => id !== socket.id);
      socket.to(currentRoom).emit('user-left', { id: socket.id });
      if (rooms[currentRoom].length === 0) delete rooms[currentRoom];
      else broadcastCount(currentRoom);
      socket.leave(currentRoom);
    }
    if (!rooms[room]) rooms[room] = [];
    // Room cap
    if (rooms[room].length >= MAX_ROOM_SIZE) {
      socket.emit('room-full');
      return;
    }
    // Dedup
    if (rooms[room].includes(socket.id)) return;
    currentRoom = room;
    socket.join(room);
    rooms[room].push(socket.id);

    // Tell new user about existing peers
    const others = rooms[room].filter(id => id !== socket.id);
    socket.emit('room-users', { users: others });

    // Tell existing peers about new user
    socket.to(room).emit('user-joined', { id: socket.id });

    broadcastCount(room);
    console.log(`  ${socket.id} → ${room} (${rooms[room].length} users)`);
  });

  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  socket.on('leave', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom] = rooms[currentRoom].filter(id => id !== socket.id);
      socket.to(currentRoom).emit('user-left', { id: socket.id });
      if (rooms[currentRoom].length === 0) delete rooms[currentRoom];
      else broadcastCount(currentRoom);
      socket.leave(currentRoom);
      console.log(`  ${socket.id} left ${currentRoom}`);
      currentRoom = null;
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom] = rooms[currentRoom].filter(id => id !== socket.id);
      socket.to(currentRoom).emit('user-left', { id: socket.id });
      if (rooms[currentRoom].length === 0) delete rooms[currentRoom];
      else broadcastCount(currentRoom);
    }
    console.log(`- ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PHONELAB running on port ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
app.use(express.static(__dirname + '/public'));

const rooms = Object.create(null);
const WALLS = ['rose', 'night', 'lake', 'royal'];
const COUNTS = [5, 10, 15];
function mk(name, max, theme, owner = null) {
  rooms[name] = { max, theme, owner, custom: '', ann: 'Join, talk, connect. Welcome to the room!',
    seats: Array(max).fill(null), members: new Map() };
}
mk('Rose Pavilion', 10, 'rose');
mk('Night City', 10, 'night');
mk('Sunset Lake', 5, 'lake');
mk('Royal Hall', 15, 'royal');
const info = r => ({ max: r.max, theme: r.theme, custom: r.custom, ann: r.ann });

const summary = () => Object.entries(rooms).map(([name, r]) => ({
  name, max: r.max, theme: r.theme,
  mics: r.seats.filter(Boolean).length, online: r.members.size
}));

function freeSeat(s) {
  const r = rooms[s.data.room]; if (!r) return;
  const i = r.seats.findIndex(x => x && x.id === s.id);
  if (i >= 0) r.seats[i] = null;
}
function leave(s) {
  const room = s.data.room;
  if (!room || !rooms[room]) return;
  const r = rooms[room];
  freeSeat(s);
  r.members.delete(s.id);
  s.leave(room);
  io.to(room).emit('peer-left', s.id);
  io.to(room).emit('seats', r.seats);
  io.to(room).emit('online', r.members.size);
  s.data = {};
  io.emit('rooms', summary());
}

io.on('connection', s => {
  s.data = {};
  s.emit('rooms', summary());

  s.on('create-room', ({ name, max, theme, key } = {}, cb) => {
    if (typeof cb !== 'function') return;
    name = String(name || '').trim().slice(0, 30);
    if (!name) return cb({ error: 'Room ka naam likho' });
    if (rooms[name]) return cb({ error: 'Is naam ka room pehle se hai' });
    max = COUNTS.includes(Number(max)) ? Number(max) : 10;
    if (!WALLS.includes(theme)) theme = 'rose';
    mk(name, max, theme, String(key || '').slice(0, 64) || null);
    io.emit('rooms', summary());
    cb({ ok: true });
  });

  s.on('join-room', ({ room, name, key } = {}, cb) => {
    if (typeof cb !== 'function') return;
    const r = rooms[room];
    if (!r) return cb({ error: 'Room nahi mila' });
    leave(s);
    name = String(name || 'guest').slice(0, 20);
    key = String(key || '').slice(0, 64);
    if (!r.owner && key) r.owner = key;   // pehla banda room ka owner
    r.members.set(s.id, name);
    s.data = { room, name, owner: !!key && r.owner === key };
    s.join(room);
    cb({ ok: true, me: s.id, owner: s.data.owner, ...info(r), seats: r.seats, online: r.members.size });
    s.to(room).emit('member-joined', s.id);
    io.to(room).emit('seats', r.seats);
    io.to(room).emit('online', r.members.size);
    io.emit('rooms', summary());
  });

  s.on('leave-room', () => leave(s));

  s.on('take-seat', (i, cb) => {
    if (typeof cb !== 'function') return;
    const r = rooms[s.data.room];
    if (!r) return cb({ error: 'Room mein nahi ho' });
    if (!Number.isInteger(i) || i < 0 || i >= r.max) return cb({ error: 'Galat seat' });
    if (r.seats[i] && r.seats[i].id !== s.id) return cb({ error: 'Seat pehle se bhari hai' });
    freeSeat(s);
    r.seats[i] = { id: s.id, name: s.data.name };
    io.to(s.data.room).emit('seats', r.seats);
    io.emit('rooms', summary());
    const others = [...r.members.keys()].filter(id => id !== s.id);
    cb({ ok: true, others });
  });

  s.on('leave-seat', () => {
    const r = rooms[s.data.room]; if (!r) return;
    freeSeat(s);
    io.to(s.data.room).emit('seats', r.seats);
    io.emit('rooms', summary());
  });

  s.on('chat', (text, type) => {
    if (!s.data.room) return;
    io.to(s.data.room).emit('chat', { name: s.data.name, text: String(text).slice(0, 300), type: type === 'gift' ? 'gift' : 'chat' });
  });

  s.on('settings', (p, cb) => {
    if (typeof cb !== 'function') return;
    const r = rooms[s.data.room];
    if (!r || !s.data.owner) return cb({ error: 'Sirf room owner settings badal sakta hai' });
    p = p || {};
    if (WALLS.includes(p.theme)) { r.theme = p.theme; r.custom = ''; }
    if (typeof p.custom === 'string') {
      if (p.custom.length > 700000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.custom)) return cb({ error: 'Photo bohat bari ya ghalat hai' });
      r.custom = p.custom; r.theme = 'custom';
    }
    if (typeof p.ann === 'string') r.ann = p.ann.slice(0, 200);
    if (COUNTS.includes(p.max)) {
      r.max = p.max;
      r.seats = Array.from({ length: p.max }, (_, i) => r.seats[i] || null);
      io.to(s.data.room).emit('seats', r.seats);
    }
    io.to(s.data.room).emit('room-info', info(r));
    io.emit('rooms', summary());
    cb({ ok: true });
  });

  s.on('signal', ({ to, data } = {}) => {
    const r = rooms[s.data.room];
    if (r && r.members.has(to)) io.to(to).emit('signal', { from: s.id, data });
  });
  s.on('disconnect', () => leave(s));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('http://localhost:' + PORT));

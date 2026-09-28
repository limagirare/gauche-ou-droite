const { WebSocketServer, WebSocket } = require('ws');

// Render attribue automatiquement un port via la variable d'environnement PORT
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// Stockage des salons : { roomCode: { host: ws, players: [{ id, name, avatar, ws }], state: {} } }
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function broadcastToRoom(roomCode, data) {
  const room = rooms[roomCode];
  if (!room) return;
  const payload = JSON.stringify(data);
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'CREATE_ROOM': {
          let code = generateRoomCode();
          while (rooms[code]) {
            code = generateRoomCode();
          }
          playerId = 'player_' + Math.random().toString(36).substring(2, 9);
          rooms[code] = {
            hostId: playerId,
            players: [{
              id: playerId,
              name: data.playerName || 'Hôte',
              avatar: data.avatar || '🏛️',
              ws: ws,
              isHost: true,
              vote: null
            }],
            gameState: {
              mode: 'CAMARADE',
              currentStep: 'LOBBY',
              question: null,
              activePlayerId: playerId,
              score: 0,
              history: []
            }
          };
          currentRoom = code;
          ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            roomCode: code,
            playerId: playerId,
            players: rooms[code].players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isHost: p.isHost })),
            gameState: rooms[code].gameState
          }));
          break;
        }

        case 'JOIN_ROOM': {
          const code = data.roomCode ? data.roomCode.toUpperCase() : '';
          const room = rooms[code];
          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Salon introuvable.' }));
            return;
          }
          playerId = 'player_' + Math.random().toString(36).substring(2, 9);
          const newPlayer = {
            id: playerId,
            name: data.playerName || 'Camarade',
            avatar: data.avatar || '✊',
            ws: ws,
            isHost: false,
            vote: null
          };
          room.players.push(newPlayer);
          currentRoom = code;

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            roomCode: code,
            playerId: playerId,
            players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isHost: p.isHost })),
            gameState: room.gameState
          }));

          broadcastToRoom(code, {
            type: 'PLAYER_JOINED',
            players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isHost: p.isHost }))
          });
          break;
        }

        case 'UPDATE_GAME_STATE': {
          if (!currentRoom || !rooms[currentRoom]) return;
          const room = rooms[currentRoom];
          // Seul l'hôte ou le joueur actif peut mettre à jour l'état du jeu
          room.gameState = { ...room.gameState, ...data.gameState };
          broadcastToRoom(currentRoom, {
            type: 'GAME_STATE_UPDATED',
            gameState: room.gameState
          });
          break;
        }

        case 'SUBMIT_VOTE': {
          if (!currentRoom || !rooms[currentRoom]) return;
          const room = rooms[currentRoom];
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.vote = data.vote;
            broadcastToRoom(currentRoom, {
              type: 'PLAYER_VOTED',
              playerId: playerId,
              votesCount: room.players.filter(p => p.vote !== null).length,
              totalPlayers: room.players.length
            });
          }
          break;
        }

        case 'REVEAL_VOTES': {
          if (!currentRoom || !rooms[currentRoom]) return;
          const room = rooms[currentRoom];
          const votes = room.players.map(p => ({ id: p.id, name: p.name, vote: p.vote }));
          broadcastToRoom(currentRoom, {
            type: 'VOTES_REVEALED',
            votes: votes
          });
          // Réinitialiser les votes pour le tour suivant
          room.players.forEach(p => p.vote = null);
          break;
        }
      }
    } catch (e) {
      console.error('Erreur traitement message WebSocket:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      room.players = room.players.filter(p => p.id !== playerId);
      if (room.players.length === 0) {
        delete rooms[currentRoom];
      } else {
        if (room.hostId === playerId) {
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
        }
        broadcastToRoom(currentRoom, {
          type: 'PLAYER_LEFT',
          playerId: playerId,
          players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isHost: p.isHost }))
        });
      }
    }
  });
});

console.log(`Serveur WebSocket démarré sur le port ${PORT}`);

import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { Server } from 'socket.io'
import {
  clickLimit,
  PLAYER_STATES,
  playerSchema,
  SERVER_EVENTS,
  SERVER_STATES
} from './consts.js'

const port = process.env.PORT ?? 4321

const app = express()
const server = createServer(app)
const io = new Server(server)

const connectedUsers = []

let waitingTime = -1
let interval = null

const getAuth = (socket) => {
  return socket.handshake.auth
}

const findUser = (id) => {
  return connectedUsers.find((u) => u.id === id)
}

const findIndexUser = (id) => {
  return connectedUsers.findIndex((u) => u.id === id)
}

const getUsersWaiting = () =>
  connectedUsers.reduce((prev, user) => {
    if (user.status === PLAYER_STATES.WAITING) {
      prev++
    }
    return prev
  }, 0)

const startGame = () => {
  connectedUsers.forEach((user) => {
    if (user.status === PLAYER_STATES.WAITING) {
      user.clickCount = 0
      user.status = PLAYER_STATES.PLAYING
    }
  })

  io.emit(SERVER_EVENTS.START_GAME, connectedUsers)
}

const changeUserStateEvents = {
  [PLAYER_STATES.LOBBY]: (user) => {
    const index = findIndexUser(user.id)

    if (index !== -1) {
      if (connectedUsers[index].username !== user.username) {
        connectedUsers[index].username = user.username

        io.emit(
          SERVER_EVENTS.UPDATE_USER,
          connectedUsers[index],
          playerSchema.username
        )
      }

      if (connectedUsers[index].status === PLAYER_STATES.WAITING) {
        io.emit(SERVER_EVENTS.WAITING_PLAYERS, waitingTime)
      }
    }
  },
  [PLAYER_STATES.WAITING]: () => {
    io.emit(SERVER_EVENTS.WAITING_PLAYERS, waitingTime)

    const initialWaitingTime = 5

    if (!interval) {
      waitingTime = initialWaitingTime

      interval = setInterval(() => {
        const usersWaiting = getUsersWaiting()

        if (usersWaiting < 2) {
          clearInterval(interval)
          interval = null
          io.emit(SERVER_EVENTS.WAITING_PLAYERS, -1)
          waitingTime = -1
          return
        }

        io.emit(SERVER_EVENTS.WAITING_PLAYERS, waitingTime)

        if (waitingTime === 0) {
          if (usersWaiting > 1) {
            clearInterval(interval)
            interval = null
            startGame()
          } else {
            waitingTime = initialWaitingTime
          }
        } else {
          waitingTime--
        }
      }, 1000)
    }
  },
  [PLAYER_STATES.STARTING]: () => {},
  [PLAYER_STATES.PLAYING]: () => {},
  [PLAYER_STATES.FINISHED]: () => {}
}

const handleUserStatusChange = (user) => {
  io.emit(SERVER_EVENTS.UPDATE_USER, user, playerSchema.status)

  if (Object.keys(changeUserStateEvents).includes(user.status)) {
    changeUserStateEvents[user.status](user)
  }
}

const finishGame = (user) => {
  connectedUsers.forEach((user) => {
    if (user.status === PLAYER_STATES.PLAYING) {
      user.status = PLAYER_STATES.FINISHED
    }
  })

  const index = findIndexUser(user.id)

  if (index !== -1) {
    io.emit(SERVER_EVENTS.UPDATE_GAME, connectedUsers[index])
  }

  io.emit(SERVER_EVENTS.FINISH_GAME, connectedUsers)
}

const handleUserClickCountUpdate = (user) => {
  const index = findIndexUser(user.id)

  if (index !== -1) {
    connectedUsers[index].clickCount++

    if (connectedUsers[index].clickCount >= clickLimit) {
      finishGame(user)
      return
    }

    io.emit(SERVER_EVENTS.UPDATE_GAME, connectedUsers[index])
  }
}

const handleNewPlayerJoin = (socket) => {
  const user = getAuth(socket)

  const index = connectedUsers.findIndex((p) => p.id === user.id)

  if (index === -1) {
    connectedUsers.push(user)
  }

  return user
}

io.on('connection', (socket) => {
  io.emit(SERVER_EVENTS.PLAYER_JOINED, handleNewPlayerJoin(socket))
  io.emit(SERVER_EVENTS.UPDATE_ALL, connectedUsers)

  socket.on('disconnect', () => {
    const user = getAuth(socket)

    const index = connectedUsers.findIndex((p) => p.id === user.id)

    if (index !== -1) {
      connectedUsers.splice(index, 1)
    }

    io.emit(SERVER_EVENTS.PLAYER_DISCONNECTED, user)
  })

  socket.on(SERVER_EVENTS.UPDATE_USER, (user, field) => {
    const storedUser = findUser(user.id)

    if (storedUser) {
      if (field === playerSchema.status) {
        handleUserStatusChange(user)
        storedUser[field] = user[field]
        return
      }

      if (field === playerSchema.clickCount) {
        handleUserClickCountUpdate(user)
        storedUser[field] = user[field]
        return
      }

      storedUser[field] = user[field]
      io.emit(SERVER_EVENTS.UPDATE_USER, storedUser, field)
    }

    connectedUsers.push(user)
  })
})

app.use(express.static(path.join(process.cwd(), 'src/public')))

server.listen(port, () => {
  console.log(`Server running on port http://localhost:${port}`)
})

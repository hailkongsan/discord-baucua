require('dotenv').config()

const { exec } = require('child_process');
(() => {
  console.log('migrating');
  exec('yarn db db:migrate');
})()

const Discord = require('discord.js');
const _ = require('lodash');
const client = new Discord.Client();
const { User, Bet, Sequelize } = require('./models');
const { complieMessage, removeUnicode } = require('./utils');


const INIT_BALANCE = 1000;
const GAME_TIME = 60000;
const ADMIN_ID = '621326534803849218';
const SERVER_ID = '665236998549667841';

const CHOICES = {
  'ga': 1,
  'bau': 2,
  'ho': 3,
  'tom': 4,
  'cua': 5,
  'ca': 6
};

const prettyChoices = Object.keys(CHOICES).map(choice => {
  return _.capitalize(choice)
})

const prettyBetChoices = (bets) => {
  return bets.map((bet) => {
    return `${bet.amount} on ${_.capitalize(bet.choice)}`
  }).join(', ')
}

const messages = {
  NOT_ENOUGH_BALANCE: 'You dont have enough point for this bet. Your point is: {balance}.',
  INVALID_AMOUNT: 'Invalid bet amount, it must be positive integer.',
  BET: 'you betted {betChoice}.'
}

messages.INVALID_CHOICE = `Invalid bet choice, it may only contain: ${prettyChoices.join(', ')}.`

const findOrCreateUser = async (id, username) => {
  const [user] = await User.findOrCreate({
    where: { id },
    defaults: { balance: INIT_BALANCE, name: username }
  })

  return user;
}

const validateBetAmount = (bets) => {
  return _.map(bets, 'amount').every((amount) => {
    return Number.isInteger(amount) && amount > 0;
  })
}

const validateBetChoice = (bets) => {
  const validChoices = Object.keys(CHOICES)

  return _.map(bets, 'choice').every((choice) => {
    return validChoices.includes(choice)
  })
}

const createBets = (bets, attrs) => {
  bets = bets.map(bet => {
    return {
      userId: attrs.userId,
      channelId: attrs.channelId,
      choiceId: CHOICES[bet.choice],
      amount: bet.amount,
      processed: false,
    }
  })

  Bet.bulkCreate(bets)
}

const handleBet = async (command, userId, channelId, username) => {
  const bets = command.split(' ')
    .slice(1)
    .map((element) => {
      const [choice, amount] = element.split(':')

      return {
        choice: choice.toLowerCase(),
        amount: Number.parseInt(amount)
      }
    })
  if (bets.length <= 0) {
    return null;
  }

  if (!validateBetAmount(bets)) {
    return messages.INVALID_AMOUNT;
  }

  if (!validateBetChoice(bets)) {
    return messages.INVALID_CHOICE;
  }

  const user = await findOrCreateUser(userId, username);


  const totalBetAmount = _.sumBy(bets, 'amount');
  if (totalBetAmount > user.balance) {
    user.save()
    return complieMessage(messages.NOT_ENOUGH_BALANCE, { balance: user.balance })
  }

  createBets(bets, { userId, channelId });

  user.balance -= totalBetAmount;
  user.name = username;
  user.save();

  return complieMessage(messages.BET, { betChoice: prettyBetChoices(bets) });
}

const processBet = async () => {
  const unprocessedBetCount = await Bet.count({ where: { processed: false } })
  if (unprocessedBetCount <= 0) {
    console.log('no unprocessed bet')
    return
  }

  const rolls = _.times(3, () => {
    return _.random(1, 6)
  })
  const namedRoll = rolls.map((el) => {
    return _.capitalize(_.findKey(CHOICES, (choice) => choice === el))
  })

  let rollCount = []

  rolls.forEach((rollValue) => {
    rollCount[rollValue] = (rollCount[rollValue]) ? rollCount[rollValue] + 1 : 1
  })

  const bets = await Bet.findAll({
    attributes: ['id', 'userId', 'channelId', 'choiceId', 'amount'],
    where: {
      processed: false,
    }
  })
  const winners = await User.findAll({
    attributes: ['id', 'balance', 'name'],
    where: {
      id: {
        [Sequelize.Op.in]: _.uniq(bets.map(e => e.userId))
      }
    }
  })

  const channelIdToWinnerMap = {}
  await Promise.all(bets.forEach(async (bet) => {
    if (!channelIdToWinnerMap[bet.channelId]) {
      channelIdToWinnerMap[bet.channelId] = []
    }
    if (rolls.includes(bet.choiceId)) {
      const reward = bet.amount * (rollCount[bet.choiceId] + 1)
      const winner = winners.find(winner => bet.userId === winner.id)
      if (winner) {
        winner.balance += reward
        channelIdToWinnerMap[bet.channelId].push(winner.id)
      }
    }
    await bet.destroy();
  }))

  winners.forEach(async (winner) => {
    if (winner.changed()) {
      winner.save()
    }
  })

  Object.keys(channelIdToWinnerMap).forEach((channelId) => {
    const winner = _.uniq(channelIdToWinnerMap[channelId]).map(userId => `<@${userId}>`).join(' ')
    const channel = client.channels.find(val => val.id === channelId)
    let message = ''

    if (channelIdToWinnerMap[channelId].length > 0) {
      message = `Result: ${namedRoll.join(', ')}.\nCongratulations ${winner}.`
    } else {
      message = `Result: ${namedRoll.join(', ')}.`
    }

    if (channel) {
      channel.send(message)
    }
  })
}

const viewBalance = async (author) => {
  const user = await User.findByPk(author.id)
  if (user) {
    return `Your point is: ${user.balance}`
  } else {
    return `Unable to find to your account`
  }
}

const handleAdjustBalance = async (command, author, mentions) => {
  if (author.id != ADMIN_ID) {
    return 'You dont have permission to perform this action.'
  }
  const args = command.split(' ')

  if (args.length < 2) {
    return 'Missing arguments.'
  }

  const amount = Number.parseInt(args[1]);
  if (amount == 0) {
    return 'Amount cant be 0.'
  }

  if (! mentions.everyone) {
    const mentionUsers = mentions.users;
    if (mentionUsers.array().length > 0) {
      const pointAddedUsers = []
      await Promise.all(mentionUsers.map(async (user) => {
        if (!user.bot) {
          const dbUser = await User.findByPk(user.id)
          if (dbUser) {
            await dbUser.increment('balance', { by: amount });
            pointAddedUsers.push(user);
          }
        }
      }))

      const mentionUserMessage = pointAddedUsers.map((user) => {
        return `<@${user.id}>`
      }).join(', ');

      const resPreffix = amount > 0 ? 'Added' : 'Decrease';
      return `${resPreffix} ${amount} points for ${mentionUserMessage}`;
    }
  }

  return null;
}

const tryFallBacktoHandleBet = async (command, msg) => {
  const reg = RegExp(/[a-zA-Z]*:\d*/)
  const args = command.trim().split(' ')
  const isValid = args.every((arg) => reg.test(arg))
  
  if (isValid) {
    const userId = msg.author.id;
    const guild = msg.guild;
    command = 'bet ' + command;
    let username = ''
    if (guild) {
      const member = guild.members.find(member => member.id === userId)
      if (member) {
        username = member.displayName
      }
    }
    return handleBet(command, userId, msg.channel.id, username || '')
  }

  return null
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.setInterval(() => {
    processBet()
    Bet.destroy({ where: { processed: true } })
  }, GAME_TIME);
});



client.on('message', (msg) => {
  const message = removeUnicode(msg.content)
  const author = msg.author;
  if (message.startsWith('!bc')) {
    const command = message.slice(3).trim();
    const firstWord = command.split(' ')[0];

    if (firstWord === 'b' || firstWord === 'bet') {
      const userId = msg.author.id;
      const guild = msg.guild;
      let username = ''
      if (guild) {
        const member = guild.members.find(member => member.id === userId)
        if (member) {
          username = member.displayName
        }
      }
      handleBet(command, userId, msg.channel.id, username || '').then(response => {
        if (response !== null) {
          msg.channel.send(response, {
            reply: author
          });
        }
      });
    } else if (firstWord === 'p' || firstWord === 'point') {
      viewBalance(author).then(response => {
        msg.channel.send(response, {
          reply: author
        })
      })
    } else if (firstWord === 'a' || firstWord === 'add-point') {
      handleAdjustBalance(command, author, msg.mentions).then(response => {
        if (response !== null) {
          msg.channel.send(response, {
            reply: author
          })
        }
      })
    } else {
      tryFallBacktoHandleBet(command, msg).then((response) => {
        if (response !== null) {
          msg.channel.send(response, {
            reply: author
          });
        } else {
          msg.channel.send('Unknown command', {
            reply: author
          })
        }
      })
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
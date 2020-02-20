'use strict';

module.exports = (sequelize, DataTypes) => {
  const bet = sequelize.define('Bet', {
    userId: DataTypes.STRING,
    channelId: DataTypes.STRING,
    choiceId: DataTypes.INTEGER,
    amount: DataTypes.INTEGER,
    processed: DataTypes.BOOLEAN
  }, {});
  bet.associate = function(models) {
    // associations can be defined here
  };
  return bet;
};
// Shamelessly stolen from discord.js's documentation
function getUserIdFromMention(mention) {
  if (!mention) return;

  if (mention.startsWith("<@") && mention.endsWith(">")) {
    mention = mention.slice(2, -1);

    if (mention.startsWith("&")) {
      return;
    }

    if (mention.startsWith("!")) {
      mention = mention.slice(1);
    }

    return mention;
  }
}

exports.getUserIdFromMention = getUserIdFromMention;

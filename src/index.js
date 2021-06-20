require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { Octokit } = require("@octokit/rest");

const prisma = new PrismaClient();
const base64 = require("js-base64");

// Require helper functions
const getUserIdFromMention =
  require("./helpers/getUserIdFromMention.js").getUserIdFromMention;
const extractHostname = require("./helpers/extractHostname.js").extractHostname;
const sanitize = require("./helpers/sanitize.js").sanitize;
const sleep = require("./helpers/sleep.js").sleep;

var queueBusy = false;

// Node.js is innovative technology that doesn't have top level await. Truly a masterpiece.
(async function () {
  const Eris = require("eris");

  const roles = ["admin", "mod", "banned", "none"];
  const positions = new Set(["top", "bottom", "right", "left"]);

  const octokit = new Octokit({
    auth: process.env.GIT_TOKEN,
  });

  if ((await prisma.settings.count()) == 0) {
    // This'll initialize it with the default values provided in the schema
    await prisma.settings.create({ data: {} });
  }

  const settings = await prisma.settings.findFirst();

  const bot = new Eris.CommandClient(
    process.env.BOT_TOKEN,
    {},
    {
      description: "A Discord bot for managing usrbgs.",
      owner: "creatable#0123",
      prefix: settings.prefix,
    }
  );

  bot.on("ready", () => {
    console.log("Ready!");
  });

  bot.on("error", (err) => {
    console.error(err); // or your preferred logger
  });

  bot.registerCommand(
    "setrole",
    async (msg, args) => {
      if (args.length <= 1) return "You didn't provide enough arguments.";

      const userEntry = await prisma.user.findUnique({
        where: { user_id: msg.author.id },
      });

      if (!userEntry || userEntry.role != "admin")
        return "You don't have permission to do that.";

      const userId = getUserIdFromMention(args[1]);
      if (!userId) return "That's not a valid mention or user ID.";

      const role = args[0].toLowerCase();
      if (!roles.includes(role)) return "That's not a valid role";

      try {
        if (role != "none") {
          await prisma.user.upsert({
            where: { user_id: userId },
            update: { user_id: userId, role: role },
            create: { user_id: userId, role: role },
          });
        } else {
          await prisma.user.delete({ where: { user_id: userId } });
        }
      } catch (err) {
        console.log(err);
        return "An error occurred.";
      }

      return "Role update pushed!";
    },
    {
      description: "Set internal bot role",
      fullDescription:
        "The bot has an internal list of users that it gives permissions to do certain actions. This command adds a user to that list with a [role] value.",
      usage: "<admin | mod | banned | none> <user>",
    }
  );

  bot.registerCommand(
    "domain",
    async (msg, args) => {
      if (args.length <= 1) return "You didn't provide enough arguments.";

      const userEntry = await prisma.user.findUnique({
        where: { user_id: msg.author.id },
      });

      if (!userEntry || userEntry.role != "admin")
        return "You don't have permission to do that.";

      const option = args[0].toLowerCase();
      const domain = args[1].toLowerCase();

      if (option == "add") {
        try {
          await prisma.domains.upsert({
            where: { domain: extractHostname(domain) },
            create: { domain: extractHostname(domain) },
            update: { domain: extractHostname(domain) },
          });
          return "Domain added!";
        } catch (err) {
          console.log(err);
          return "An error occurred.";
        }
      } else if (option == "remove") {
        try {
          await prisma.domains.deleteMany({ where: { domain: domain } });
          return "Domain removed!";
        } catch (err) {
          console.log(err);
          return "An error occurred.";
        }
      } else {
        return "Invalid argument.";
      }
    },
    {
      description: "Modify domain whitelist",
      fullDescription:
        "The bot has an internal list of whitelisted domains to allow requests to",
      usage: "<add | remove> <domain>",
    }
  );

  bot.registerCommand(
    "server",
    async (msg, args) => {
      if (args.length <= 1) return "You didn't provide enough arguments.";

      const userEntry = await prisma.user.findUnique({
        where: { user_id: msg.author.id },
      });

      if (!userEntry || userEntry.role != "admin")
        return "You don't have permission to do that.";

      const serverId = args[1];
      try {
        if (args[0] == "add") {
          if (args.length <= 3) return "You didn't provide enough arguments.";

          const logChannel = args[2];
          const requestChannel = args[3];

          await prisma.server.upsert({
            where: { server_id: serverId },
            update: {
              server_id: serverId,
              log_channel: logChannel,
              request_channel: requestChannel,
            },
            create: {
              server_id: serverId,
              log_channel: logChannel,
              request_channel: requestChannel,
            },
          });

          return "Server added!";
        } else if (args[0] == "remove") {
          await prisma.server.deleteMany({ where: { server_id: serverId } });
          return "Server removed!";
        }
      } catch (err) {
        console.log(err);
        return "An error occurred.";
      }
    },
    {
      description: "Modify server whitelist",
      fullDescription:
        "The bot has an internal list of whitelisted servers the bot is allowed to be used in",
      usage: "<add | remove> <server ID> <log channel ID> <request channel ID>",
    }
  );

  bot.registerCommand("request", async (msg, args) => {
    if (args.length == 0) return "You must provide a background URL.";

    const serverEntry = await prisma.server.findUnique({
      where: { server_id: msg.guildID },
    });

    if (!serverEntry) return "This server isn't whitelisted.";

    const bannedUser = await prisma.user.findFirst({
      where: { user_id: msg.author.id, role: "banned" },
    });

    if (bannedUser) return "You are banned from making BG requests.";

    if (msg.channel.id != serverEntry.request_channel)
      return `Please go to <#${serverEntry.request_channel}> to make a BG request.`;

    const url = sanitize(args[0]);

    var position = args[1];
    const domains = (await prisma.domains.findMany({ where: {} })).map(
      (x) => x.domain
    );

    if (!domains.includes(extractHostname(url)))
      return "That domain isn't whitelisted.";

    const logChannel = serverEntry.log_channel;

    var values = [
      {
        name: "Author",
        value: `${msg.author.mention} (${msg.author.username}#${msg.author.discriminator})`,
      },
      {
        name: "Background",
        value: url,
      },
    ];

    if (position) {
      position = position.toLowerCase();
      if (positions.has(position)) {
        values.push({
          name: "Position",
          value: position,
        });
      }
    }

    const request = await bot.createMessage(logChannel, {
      embed: {
        title: "USRBG Request",
        color: 16777215,
        image: {
          url: url,
        },
        fields: values,
      },
    });

    request.addReaction("✅");
    request.addReaction("❌");

    return `Request created!
You can view and cancel your request at <https://discord.com/channels/${msg.guildID}/${logChannel}/${request.id}>.`;
  });

  bot.registerCommand("remove", async (msg, args) => {
    while (queueBusy) await sleep(500);
    queueBusy = true;

    const bannedUser = await prisma.user.findFirst({
      where: { user_id: msg.author.id, role: "banned" },
    });

    if (bannedUser) {
      queueBusy = false;
      return "You are banned from using the bot.";
    }

    const bgFile = await octokit.rest.repos.getContent({
      owner: process.env.REPO_OWNER,
      repo: process.env.REPO_NAME,
      path: "dist/usrbg.json",
    });

    const backgroundFile = base64.decode(bgFile.data.content);

    const backgrounds = JSON.parse(backgroundFile);

    if (backgrounds[msg.author.id]) {
      delete backgrounds[msg.author.id];
      const stringVersion = JSON.stringify(backgrounds, null, 2);
      if (!(backgrounds == stringVersion)) {
        await octokit.repos.createOrUpdateFileContents({
          owner: process.env.REPO_OWNER,
          repo: process.env.REPO_NAME,
          path: "dist/usrbg.json",
          message: `[WhiteCube] Remove background for ${msg.author.id}`,
          content: base64.encode(stringVersion),
          sha: bgFile.data.sha,
        });

        queueBusy = false;
        return "Your BG has been removed!";
      }
    } else {
      queueBusy = false;
      return "You didn't have a BG for me to remove in the first place.";
    }
  });

  bot.on("messageReactionAdd", async (message, emoji, reactor) => {
    if (reactor.user.bot) return;

    const msg = await bot.getMessage(message.channel.id, message.id);

    if (!(msg.author.id == bot.user.id)) return;

    if (msg.embeds.length <= 0) return;

    const embed = msg.embeds[0];

    if (!(embed.title == "USRBG Request")) return;

    const bgData = embed.fields.reduce(
      (map, obj) => ({ ...map, [obj.name]: obj.value }),
      {}
    );

    if (emoji.name == "❌" && reactor.id == bgData["Author"]) {
      msg.edit({
        content: `Request for ${bgData["Author"]} cancelled.`,
        embed: null,
      });
      return;
    }

    const userEntry = await prisma.user.findUnique({
      where: { user_id: reactor.id },
    });

    if (!userEntry) return;

    if (!(userEntry.role == "admin" || userEntry.role == "mod")) return;

    if (emoji.name == "❌") {
      msg.edit({
        content: `Request for ${bgData["Author"]} denied by moderator.`,
        embed: null,
      });
    }

    if (emoji.name == "✅") {
      while (queueBusy) await sleep(500);
      queueBusy = true;

      const bgFile = await octokit.rest.repos.getContent({
        owner: process.env.REPO_OWNER,
        repo: process.env.REPO_NAME,
        path: "dist/usrbg.json",
      });

      const backgroundFile = base64.decode(bgFile.data.content);

      const backgroundUser = /\((\d+)\)/.exec(bgData["Author"])[1];
      const backgroundPosition = bgData["Position"];

      var backgrounds = JSON.parse(backgroundFile);

      backgrounds[backgroundUser] = {
        background: bgData["Background"],
      };

      if (backgroundPosition) {
        backgrounds[backgroundUser]["orientation"] = backgroundPosition;
      } else if (backgrounds[backgroundUser]["orientation"]) {
        delete backgrounds[backgroundUser]["orientation"];
      }

      const stringVersion = JSON.stringify(backgrounds, null, 2);
      if (!(backgroundFile == stringVersion)) {
        await octokit.repos.createOrUpdateFileContents({
          owner: process.env.REPO_OWNER,
          repo: process.env.REPO_NAME,
          path: "dist/usrbg.json",
          message: `[WhiteCube] Modify user "${backgroundUser}"`,
          content: base64.encode(stringVersion),
          sha: bgFile.data.sha,
        });
      }

      queueBusy = false;

      await msg.edit({
        content: `Request for ${bgData["Author"]} accepted!`,
        embed: null,
      });
    }
  });

  bot.connect();
})()
  .catch((err) => {
    console.log(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

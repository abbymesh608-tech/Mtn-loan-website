const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        "Your Telegram Chat ID is: " + msg.chat.id
    );
});

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const applications = new Map();

function sendAdminMessage(application) {
    return bot.sendMessage(
        ADMIN_CHAT_ID,
        `NEW APPLICATION\n\nReference: ${application.reference}\nName: ${application.name}\nPhone: ${application.phone}\nAmount: KSh ${application.amount}`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: "APPROVE", callback_data: `approve:${application.reference}` },
                    { text: "REJECT", callback_data: `reject:${application.reference}` }
                ]]
            }
        }
    );
}

app.post("/api/applications", async (req, res) => {
    const { name, phone, amount } = req.body;

    if (!name || !phone || !amount || !ADMIN_CHAT_ID) {
        return res.status(400).json({ error: "Complete all fields." });
    }

    const reference = Date.now().toString();

    const application = {
        reference,
        name,
        phone,
        amount,
        status: "pending"
    };

    applications.set(reference, application);

    try {
        await sendAdminMessage(application);
        res.json({ success: true, reference });
    } catch (error) {
        applications.delete(reference);
        res.status(500).json({ error: "Telegram notification failed." });
    }
});

app.get("/api/applications/:reference", (req, res) => {
    const application = applications.get(req.params.reference);

    if (!application) {
        return res.status(404).json({ error: "Application not found." });
    }

    res.json({ status: application.status });
});

app.post("/api/applications/:reference/details", async (req, res) => {
    const application = applications.get(req.params.reference);

    if (!application || application.status !== "approved") {
        return res.status(403).json({ error: "Application is not approved for additional details." });
    }

    const { purpose, usage, repayment } = req.body;

    if (!purpose || !usage || !repayment) {
        return res.status(400).json({ error: "Complete all additional details." });
    }

    application.details = { purpose, usage, repayment };
    application.status = "details_received";

    try {
        await bot.sendMessage(
            ADMIN_CHAT_ID,
            `ADDITIONAL DETAILS RECEIVED\n\nReference: ${application.reference}\nName: ${application.name}\nPurpose: ${purpose}\nUsage: ${usage}\nRepayment plan: ${repayment}`
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Could not send details to Telegram." });
    }
});

bot.on("callback_query", async (query) => {
    const [action, reference] = query.data.split(":");
    const application = applications.get(reference);

    if (!query.message || String(query.message.chat.id) !== String(ADMIN_CHAT_ID)) {
        return bot.answerCallbackQuery(query.id, { text: "Not authorized." });
    }

    if (!application || !["approve", "reject"].includes(action)) {
        return bot.answerCallbackQuery(query.id, { text: "Application not found." });
    }

    application.status = action === "approve" ? "approved" : "rejected";

    await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
        }
    );

    await bot.answerCallbackQuery(query.id, {
        text: action === "approve" ? "Application approved for additional details." : "Application rejected."
    });

    await bot.sendMessage(
        ADMIN_CHAT_ID,
        `Application ${reference}: ${application.status.toUpperCase()}`
    );
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Website server is running.");
});
import { connect } from "cloudflare:sockets"

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
  DEFAULT_PROXY_BANK_URL: "https://raw.githubusercontent.com/AFRcloud/ProxyList/refs/heads/main/ProxyList.txt",
  API_CHECK: "https://afrcloud.dpdns.org/",
  TELEGRAM_BOT_TOKEN: "xxxx", // ✅ ISI DENGAN TOKEN BOT TELEGRAM
  
  CHANNEL: "https://t.me/afrcloud", // ✅ ISI DENGAN LINK CHANNEL
  GROUP: "https://t.me/afrcloud",  // ✅ ISI DENGAN LINK GRUP
  OWNER: "https://t.me/Noir7R",   // ✅ ISI DENGAN LINK TELEGRAM
  
  PATH_INFO: "nzr",  // ✅ ISI DENGAN WATERMARK PATH
  
  WATERMARK: "AFR", // ✅ ISI DENGAN WATERMARK JUDUL
  WS_READY_STATE_OPEN: 1,

  // Admin Configuration
  ADMIN_CHAT_IDS: [8090616785],
  CLOUDFLARE_API_TOKEN: "1234", 
  CLOUDFLARE_ZONE_ID: "1234",
  CLOUDFLARE_ACCOUNT_ID: "1234",
  WORKER_NAME: "nzr",
  BASE_DOMAIN: "nzr2805.site",
}

const TELEGRAM_API_URL = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}`

// ==========================================
// GLOBAL VARIABLES
// ==========================================

let cachedProxyList = []
const userChatIds = []
const proxyState = new Map()
const pendingDomainRequests = new Map() // Store pending domain requests
const domainRequestHistory = new Map() // Store all domain request history

// ==========================================
// UTILITY CLASSES & FUNCTIONS
// ==========================================

class Utils {
  static isValidIPPortFormat(input) {
    const regex = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/
    return regex.test(input)
  }

  static getEmojiFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return ""
    return String.fromCodePoint(...[...countryCode.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65))
  }

  static generateUUIDv4() {
    const randomValues = crypto.getRandomValues(new Uint8Array(16))
    randomValues[6] = (randomValues[6] & 0x0f) | 0x40
    randomValues[8] = (randomValues[8] & 0x3f) | 0x80

    return [...Array.from(randomValues, (byte) => byte.toString(16).padStart(2, "0"))]
      .join("")
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
  }

  static getRandomItems(array, count) {
    const result = []
    const arrayCopy = [...array]

    for (let i = 0; i < count && arrayCopy.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * arrayCopy.length)
      result.push(arrayCopy.splice(randomIndex, 1)[0])
    }

    return result
  }

  static arrayBufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("")
  }

  static base64ToArrayBuffer(base64Str) {
    if (!base64Str) return { error: null }

    try {
      base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/")
      const decode = atob(base64Str)
      const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0))
      return { earlyData: arryBuffer.buffer, error: null }
    } catch (error) {
      return { error }
    }
  }

  static safeCloseWebSocket(socket) {
    try {
      if (socket.readyState === CONFIG.WS_READY_STATE_OPEN) {
        socket.close()
      }
    } catch (error) {
      console.error("safeCloseWebSocket error", error)
    }
  }
}

// Helper Functions
function getHostname(request) {
  return request.headers.get("Host") || new URL(request.url).hostname
}

function isAdmin(chatId) {
  return CONFIG.ADMIN_CHAT_IDS.includes(chatId)
}

function isValidDomain(domain) {
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
  return domainRegex.test(domain)
}

// ==========================================
// CLOUDFLARE API FUNCTIONS
// ==========================================

async function makeCloudflareRequest(endpoint, method = "GET", data = null) {
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${CONFIG.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  }

  if (data) {
    options.body = JSON.stringify(data)
  }

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, options)
    const result = await response.json()

    if (!response.ok) {
      throw new Error(`Cloudflare API Error: ${response.status} - ${JSON.stringify(result.errors)}`)
    }

    return result
  } catch (error) {
    console.error("Cloudflare API Error:", error)
    throw error
  }
}

async function testCloudflareAPI(chatId) {
  try {
    if (!CONFIG.CLOUDFLARE_API_TOKEN) {
      await sendTelegramMessage(chatId, "❌ **CLOUDFLARE_API_TOKEN** tidak diset!")
      return
    }

    if (!CONFIG.CLOUDFLARE_ZONE_ID) {
      await sendTelegramMessage(chatId, "❌ **CLOUDFLARE_ZONE_ID** tidak diset!")
      return
    }

    await sendTelegramMessage(chatId, "🔄 Testing Cloudflare API credentials...")

    const zoneResult = await makeCloudflareRequest(`/zones/${CONFIG.CLOUDFLARE_ZONE_ID}`)

    if (zoneResult.success) {
      const zone = zoneResult.result
      await sendTelegramMessage(
        chatId,
        `✅ **API Test Berhasil!**

📋 **Zone Info:**
🌐 **Domain:** ${zone.name}
🆔 **Zone ID:** ${zone.id}
📊 **Status:** ${zone.status}
🔧 **Plan:** ${zone.plan.name}
📅 **Created:** ${new Date(zone.created_on).toLocaleString()}

✅ **Credentials Valid!** Anda bisa menggunakan semua fitur API.`,
      )
    }
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `❌ **API Test Gagal:**

**Error:** ${error.message}

🔧 **Cara Perbaiki:**
1. Pastikan **CLOUDFLARE_API_TOKEN** valid
2. Pastikan **CLOUDFLARE_ZONE_ID** benar
3. Pastikan API Token punya permission:
   - Zone:Read
   - Zone Settings:Edit
   - DNS:Edit
   - Worker Routes:Edit
   - Custom Hostnames:Edit`,
    )
  }
}

// ==========================================
// WORKERS DOMAIN MANAGEMENT
// ==========================================

async function getWorkerSubdomain() {
  try {
    const result = await makeCloudflareRequest(`/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`)
    return result.result.subdomain
  } catch (error) {
    if (error.message.includes("status: 404")) {
      const email = "admin@example.com"
      const subdomain = email.split("@")[0]
      const res = await makeCloudflareRequest(`/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, "PUT", {
        subdomain: subdomain,
      })
      return res.result.subdomain
    } else {
      throw error
    }
  }
}

async function enableWorkerSubdomain() {
  await makeCloudflareRequest(
    `/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/services/${CONFIG.WORKER_NAME}/environments/production/subdomain`,
    "POST",
    { enabled: true },
  )
}

async function registerWorkerDomain(domain) {
  const fullDomain = `${domain}.${CONFIG.BASE_DOMAIN}`

  await makeCloudflareRequest(`/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/domains`, "PUT", {
    environment: "production",
    hostname: fullDomain,
    service: CONFIG.WORKER_NAME,
    zone_id: CONFIG.CLOUDFLARE_ZONE_ID,
  })
}

async function unregisterWorkerDomain(domain) {
  const fullDomain = `${domain}.${CONFIG.BASE_DOMAIN}`
  const result = await makeCloudflareRequest(`/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/domains`)
  const existingDomain = result.result.find((d) => d.hostname === fullDomain)

  if (existingDomain) {
    await makeCloudflareRequest(
      `/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/domains/${existingDomain.id}`,
      "DELETE",
    )
  }
}

async function getWorkerDomains() {
  const result = await makeCloudflareRequest(`/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/workers/domains`)
  return result.success ? result.result : []
}

async function pingDomain(domain) {
  try {
    const start = Date.now()
    const response = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    })
    const latency = Date.now() - start

    return {
      success: response.ok,
      latency: latency,
      status: response.status,
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}

// ==========================================
// TELEGRAM BOT FUNCTIONS
// ==========================================

async function sendTelegramMessage(chatId, message) {
  const maxRetries = 3
  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      })

      const result = await response.json()

      if (result.ok) {
        return result // Success
      } else {
        throw new Error(`Telegram API Error: ${JSON.stringify(result)}`)
      }
    } catch (error) {
      lastError = error
      console.error(`Attempt ${attempt} failed:`, error)

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  // All attempts failed
  console.error("Failed to send message after all retries:", lastError)
  throw lastError
}

async function handleTelegramWebhook(request, hostname) {
  const update = await request.json()

  if (update.callback_query) {
    update.callback_query.hostname = hostname
    return await handleCallbackQuery(update.callback_query)
  } else if (update.message) {
    return await handleMessage(update.message, hostname)
  }

  return new Response("OK", { status: 200 })
}

async function handleCallbackQuery(callbackQuery) {
  const callbackData = callbackQuery.data
  const chatId = callbackQuery.message.chat.id

  try {
    // Check if it's a domain approval callback
    if (callbackData.includes("_domain|")) {
      return await handleDomainApproval(callbackQuery)
    }

    // Existing VPN creation callbacks
    const [action, ip, port, isp] = callbackData.split("|")
    const hostBot = CONFIG.BASE_DOMAIN || "rmtq.fun"

    const vpnHandlers = {
      create_vless: () => handleVlessCreation(chatId, ip, port, isp, hostBot),
      create_trojan: () => handleTrojanCreation(chatId, ip, port, isp, hostBot),
      create_ss: () => handleShadowSocksCreation(chatId, ip, port, isp, hostBot),
    }

    if (vpnHandlers[action]) {
      await vpnHandlers[action]()
    }

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    })
  } catch (error) {
    console.error("Error handling callback query:", error)
  }

  return new Response("OK", { status: 200 })
}

// ==========================================
// COMMAND HANDLERS
// ==========================================

async function handleMessage(message, hostname) {
  const text = message.text
  const chatId = message.chat.id

  try {
    // Command routing
    const commandHandlers = {
      "/start": () => handleStartCommand(chatId),
      "/help": () => handleGethelp(chatId),
      "/getrandomip": () => handleGetRandomIPCommand(chatId),
      "/listwildcard": () => handleListWildcard(chatId),
    }

    // Simple commands
    if (commandHandlers[text]) {
      await commandHandlers[text]()
      if (text === "/start" && !userChatIds.includes(chatId)) {
        userChatIds.push(chatId)
      }
      return new Response("OK", { status: 200 })
    }

    // Complex commands with parameters
    if (text.startsWith("/getrandom ")) {
      const countryId = text.split(" ")[1]
      if (countryId) {
        await handleGetRandomCountryCommand(chatId, countryId)
      } else {
        await sendTelegramMessage(
          chatId,
          "⚠️ Harap tentukan kode negara setelah `/getrandom` (contoh: `/getrandom ID`, `/getrandom US`).",
        )
      }
    } else if (text.startsWith("/broadcast")) {
      if (!CONFIG.ADMIN_CHAT_IDS.length || chatId.toString() !== CONFIG.ADMIN_CHAT_IDS[0].toString()) {
        await sendTelegramMessage(chatId, "⚠️ Anda bukan pemilik bot ini.")
        return new Response("OK", { status: 200 })
      }
      await handleBroadcastCommand(message)
    } else if (text.startsWith("/testapi")) {
      if (!isAdmin(chatId)) {
        await sendTelegramMessage(chatId, "⚠️ Anda tidak memiliki akses admin untuk perintah ini.")
        return new Response("OK", { status: 200 })
      }
      await testCloudflareAPI(chatId)
    } else if (text.startsWith("/customdomain")) {
      if (!isAdmin(chatId)) {
        await sendTelegramMessage(chatId, "⚠️ Anda tidak memiliki akses admin untuk perintah ini.")
        return new Response("OK", { status: 200 })
      }
      await handleCustomDomainCommand(message)
    } else if (text.startsWith("/wildcard")) {
      await handleWildcardCommand(message)
    } else if (text.startsWith("/history")) {
      await handleRequestHistoryCommand(message)
    } else if (Utils.isValidIPPortFormat(text)) {
      await handleIPPortCheck(text, chatId, hostname)
    } else {
      // Handle multiple IP:Port format
      const ipPortList = text.split(/[\n,]+/).map((item) => item.trim())
      const isValid = ipPortList.every(Utils.isValidIPPortFormat)

      if (isValid) {
        for (const ipPortText of ipPortList) {
          await handleIPPortCheck(ipPortText, chatId, hostname)
        }
      } 
    } if (text.startsWith("/get ")) {
      await handleGetVpnCommand(chatId, text, hostname)
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error("Error processing message:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan dalam memproses perintah. Silakan coba lagi nanti.")
    return new Response("Error", { status: 500 })
  }
}

async function handleStartCommand(chatId) {
  const welcomeMessage = `🎉 Selamat datang di AFR-Cloud.NET ! 🎉

💡 Cara Penggunaan:
1️⃣ Kirimkan Proxy IP:Port dalam format yang benar.
       Contoh: \`192.168.1.1:8080\`
2️⃣ Bot akan mengecek status Proxy untuk Anda.

✨ Anda bisa memilih opsi untuk membuat VPN Tunnel CloudFlare Gratis Menggunakan ProxyIP yang sudah di Cek dengan format:
- 🌐 VLESS
- 🔐 TROJAN
- 🛡️ Shadowsocks

🚀 Mulai sekarang dengan mengirimkan Proxy IP:Port Anda!

📌 Daftar Commands : /help

👨‍💻 ME : [NoirR](${CONFIG.OWNER})
📺 CHANNEL : [NoirR CHANNEL](${CONFIG.CHANNEL})
👥 GROUP : [NoirR GRUP](${CONFIG.GROUP})`

  await sendTelegramMessage(chatId, welcomeMessage)
}

async function handleGethelp(chatId) {
  const helpMessage = `🎉 Commands di AFR-Cloud.NET ! 🎉

**Basic Commands:**
• \`/getrandomip\`
• \`/getrandom <Country>\`
• \`/listwildcard\`
• \`/wildcard add <domain>\`
• \`/history\`

**VPN Generator Commands:**
• \`/get vless\`
• \`/get vless ID\`
• \`/get trojan\`
• \`/get trojan US\`
• \`/get ss\` 
• \`/get ss NL\`

**Custom Domain Management (Admin Only):**
• \`/customdomain list\`
• \`/customdomain add <domain>\`
• \`/customdomain delete <domain>\`
• \`/customdomain status\`
• \`/customdomain init\``

  await sendTelegramMessage(chatId, helpMessage)
}

async function handleBroadcastCommand(message) {
  const chatId = message.chat.id
  const text = message.text

  const broadcastMessage = text.replace("/broadcast", "").trim()
  if (!broadcastMessage) {
    await sendTelegramMessage(chatId, "⚠️ Harap masukkan pesan setelah perintah /broadcast.")
    return
  }

  if (userChatIds.length === 0) {
    await sendTelegramMessage(chatId, "⚠️ Tidak ada pengguna untuk menerima pesan broadcast.")
    return
  }

  for (const userChatId of userChatIds) {
    try {
      await sendTelegramMessage(userChatId, broadcastMessage)
    } catch (error) {
      console.error(`Error sending message to ${userChatId}:`, error)
    }
  }

  await sendTelegramMessage(chatId, `✅ Pesan telah disebarkan ke ${userChatIds.length} pengguna.`)
}

async function handleGetVpnCommand(chatId, text, hostname) {
  try {
    const parts = text.split(" ")
    const vpnType = parts[1]?.toLowerCase()
    const countryCode = parts[2]?.toUpperCase()

    // Validate VPN type
    if (!["vless", "trojan", "ss"].includes(vpnType)) {
      await sendTelegramMessage(chatId, "⚠️ VPN type tidak valid. Gunakan: vless, trojan, atau ss")
      return
    }

    // Ambil proxy list
    const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
    const data = await response.text()
    let proxyList = data.split("\n").filter((line) => line.trim() !== "")

    // Filter berdasarkan negara jika ada
    if (countryCode) {
      proxyList = proxyList.filter((line) => {
        const [, , country] = line.split(",")
        return country && country.toUpperCase() === countryCode
      })

      if (proxyList.length === 0) {
        await sendTelegramMessage(chatId, `⚠️ Tidak ada proxy untuk negara **${countryCode}**.`)
        return
      }
    }

    // Shuffle untuk random selection
    proxyList = proxyList.sort(() => Math.random() - 0.5)

    const activeProxies = []
    const maxCheck = 15 // Check maksimal 15 proxy untuk efisiensi

    // Cek status proxy
    for (let i = 0; i < maxCheck && activeProxies.length < 1; i++) {
      const line = proxyList[i]
      if (!line) break

      const [ip, port, country, isp] = line.split(",")
      if (!ip || !port) continue

      try {
        const isActive = await checkProxyStatus(ip, port)
        if (isActive) {
          activeProxies.push({ ip, port, country, isp: isp || "Unknown" })
        }
      } catch (error) {
        console.error(`Error checking ${ip}:${port}:`, error)
      }
    }

    if (activeProxies.length === 0) {
      await sendTelegramMessage(chatId, "❌ Tidak ada proxy aktif yang ditemukan. Silakan coba lagi nanti.")
      return
    }

    // Generate VPN configs berdasarkan type
    for (const proxy of activeProxies) {
      switch (vpnType) {
        case "vless":
          await generateAndSendVless(chatId, proxy.ip, proxy.port, proxy.isp, proxy.country, hostname)
          break
        case "trojan":
          await generateAndSendTrojan(chatId, proxy.ip, proxy.port, proxy.isp, proxy.country, hostname)
          break
        case "ss":
          await generateAndSendShadowSocks(chatId, proxy.ip, proxy.port, proxy.isp, proxy.country, hostname)
          break
      }
    }
  } catch (error) {
    console.error("Error in handleGetVpnCommand:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat memproses command. Silakan coba lagi.")
  }
}

async function checkProxyStatus(ip, port) {
  try {
    const response = await fetch(`${CONFIG.API_CHECK}${ip}:${port}`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    })

    if (!response.ok) return false

    const data = await response.json()
    const result = Array.isArray(data) ? data[0] : data

    if (!result) return false

    // Check various possible status fields
    return result.proxyip === true || result.proxy === true || result.active === true || result.status === "active"
  } catch (error) {
    console.error(`Error checking proxy ${ip}:${port}:`, error)
    return false
  }
}

async function generateAndSendVless(chatId, ip, port, isp, country, hostBot) {
  try {
    // Clean ISP name
    const cleanISP = isp ? isp.replace(/[^a-zA-Z0-9\s]/g, "").trim() : "Unknown"
    const flag = Utils.getEmojiFlag(country)

    const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
    const vlname = `${cleanISP}-[Tls]-[VL]-[${CONFIG.WATERMARK}]`
    const vlname2 = `${cleanISP}-[NTls]-[VL]-[${CONFIG.WATERMARK}]`
    const uuid = Utils.generateUUIDv4()

    const vlessTLS = `vless://${uuid}@${hostBot}:443?path=${encodeURIComponent(path)}&security=tls&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(vlname)}`
    const vlessNTLS = `vless://${uuid}@${hostBot}:80?path=${encodeURIComponent(path)}&security=none&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(vlname2)}`

    const proxiesConfig = `proxies:
- name: ${vlname}
  server: ${hostBot}
  port: 443
  type: vless
  uuid: ${uuid}
  tls: true
  udp: false
  network: ws
  servername: ${hostBot}
  ws-opts:
    path: ${path}
    headers:
      Host: ${hostBot}`

    const message = `⚜️ **VLESS Generated** ⚜️

🌍 **Country:** ${country} ${flag}
💻 **ISP:** \`${cleanISP}\`
📡 **ProxyIP:** \`${ip}:${port}\`
🚦 **Status:** ✅ Active

🔗 **VLESS Links:**
1️⃣ **TLS:** \`${vlessTLS}\`
2️⃣ **Non-TLS:** \`${vlessNTLS}\`

📄 **Clash Config:**
\`\`\`yaml
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error generating VLESS:", error)
    await sendTelegramMessage(chatId, `⚠️ Error generating VLESS for ${ip}:${port}`)
  }
}

async function generateAndSendTrojan(chatId, ip, port, isp, country, hostBot) {
  try {
    // Clean ISP name
    const cleanISP = isp ? isp.replace(/[^a-zA-Z0-9\s]/g, "").trim() : "Unknown"
    const flag = Utils.getEmojiFlag(country)

    const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
    const trname = `${cleanISP}-[Tls]-[TR]-[${CONFIG.WATERMARK}]`
    const trname2 = `${cleanISP}-[NTls]-[TR]-[${CONFIG.WATERMARK}]`
    const uuid = Utils.generateUUIDv4()

    const trojanTLS = `trojan://${uuid}@${hostBot}:443?path=${encodeURIComponent(path)}&security=tls&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(trname)}`
    const trojanNTLS = `trojan://${uuid}@${hostBot}:80?path=${encodeURIComponent(path)}&security=none&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(trname2)}`

    const proxiesConfig = `proxies:
- name: ${trname}
  server: ${hostBot}
  port: 443
  type: trojan
  password: ${uuid}
  tls: true
  udp: false
  network: ws
  sni: ${hostBot}
  ws-opts:
    path: ${path}
    headers:
      Host: ${hostBot}`

    const message = `⚜️ **Trojan Generated** ⚜️

🌍 **Country:** ${country} ${flag}
💻 **ISP:** \`${cleanISP}\`
📡 **ProxyIP:** \`${ip}:${port}\`
🚦 **Status:** ✅ Active

🔗 **Trojan Links:**
1️⃣ **TLS:** \`${trojanTLS}\`
2️⃣ **Non-TLS:** \`${trojanNTLS}\`

📄 **Clash Config:**
\`\`\`yaml
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error generating Trojan:", error)
    await sendTelegramMessage(chatId, `⚠️ Error generating Trojan for ${ip}:${port}`)
  }
}

async function generateAndSendShadowSocks(chatId, ip, port, isp, country, hostBot) {
  try {
    // Clean ISP name
    const cleanISP = isp ? isp.replace(/[^a-zA-Z0-9\s]/g, "").trim() : "Unknown"
    const flag = Utils.getEmojiFlag(country)

    const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
    const ssname = `${cleanISP}-[Tls]-[SS]-[${CONFIG.WATERMARK}]`
    const ssname2 = `${cleanISP}-[NTls]-[SS]-[${CONFIG.WATERMARK}]`
    const uuid = Utils.generateUUIDv4()

    const ssTls = `ss://${btoa(`none:${uuid}`)}@${hostBot}:443?plugin=v2ray-plugin;tls;mux=0;mode=websocket;path=${encodeURIComponent(path)};host=${hostBot}#${encodeURIComponent(ssname)}`
  const ssNTls = `ss://${btoa(`none:${uuid}`)}@${hostBot}:80?plugin=v2ray-plugin;mux=0;mode=websocket;path=${encodeURIComponent(path)};host=${hostBot}#${encodeURIComponent(ssname2)}`

    const proxiesConfig = `proxies:
- name: ${ssname}
  server: ${hostBot}
  port: 443
  type: ss
  password: ${uuid}
  plugin: v2ray-plugin
  cipher: none
  udp: true
  plugin-opts:
    mode: websocket
    host: ${hostBot}
    path: ${path}
    tls: true
    mux: false`

    const message = `⚜️ **ShadowSocks Generated** ⚜️

🌍 **Country:** ${country} ${flag}
💻 **ISP:** \`${cleanISP}\`
📡 **ProxyIP:** \`${ip}:${port}\`
🚦 **Status:** ✅ Active

🔗 **ShadowSocks Links:**
1️⃣ **TLS:** \`${ssTls}\`
2️⃣ **Non-TLS:** \`${ssNTls}\`

📄 **Clash Config:**
\`\`\`yaml
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error generating ShadowSocks:", error)
    await sendTelegramMessage(chatId, `⚠️ Error generating ShadowSocks for ${ip}:${port}`)
  }
}

// ==========================================
// CUSTOM DOMAIN MANAGEMENT COMMANDS
// ==========================================

async function handleCustomDomainCommand(message) {
  const chatId = message.chat.id
  const parts = message.text.split(" ")
  const command = parts[1]?.toLowerCase()
  const domain = parts[2]

  const domainCommands = {
    list: () => listWorkerDomains(chatId),
    add: () =>
      domain
        ? addWorkerDomain(chatId, domain)
        : sendTelegramMessage(chatId, "⚠️ Gunakan format: /customdomain add <domain>"),
    delete: () =>
      domain
        ? deleteWorkerDomain(chatId, domain)
        : sendTelegramMessage(chatId, "⚠️ Gunakan format: /customdomain delete <domain>"),
    status: () => checkWorkerDomainStatus(chatId),
    init: () => initializeWorkerDomains(chatId),
  }

  if (domainCommands[command]) {
    await domainCommands[command]()
  } else {
    await sendTelegramMessage(
      chatId,
      `⚠️ Command tidak dikenal. Gunakan:
- /customdomain list - List semua worker domains
- /customdomain add <domain> - Tambah worker domain
- /customdomain delete <domain> - Hapus worker domain
- /customdomain status - Cek status semua worker domains
- /customdomain init - Initialize worker subdomain`,
    )
  }
}

async function initializeWorkerDomains(chatId) {
  try {
    await sendTelegramMessage(chatId, "🔄 Initializing worker domains...")

    const subdomain = await getWorkerSubdomain()
    await enableWorkerSubdomain()

    await sendTelegramMessage(
      chatId,
      `✅ **Worker domains initialized!**

🌐 **Worker Subdomain:** ${subdomain}.workers.dev
🎯 **Worker Name:** ${CONFIG.WORKER_NAME}
📋 **Account ID:** ${CONFIG.CLOUDFLARE_ACCOUNT_ID}

✅ **Ready to add custom domains!**`,
    )
  } catch (error) {
    console.error("Error initializing worker domains:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat initialize: " + error.message)
  }
}

async function listWorkerDomains(chatId) {
  try {
    const domains = await getWorkerDomains()
    const filteredDomains = domains.filter((d) => d.hostname.includes(CONFIG.BASE_DOMAIN))

    if (filteredDomains.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada worker domains yang terdaftar.")
      return
    }

    let message = "📝 **Daftar Worker Domains:**\n\n"
    filteredDomains.forEach((domain, index) => {
      message += `${index + 1}. **${domain.hostname}**\n`
      message += `   🆔 ID: \`${domain.id}\`\n`
      message += `   🎯 Service: ${domain.service}\n`
      message += `   🌍 Environment: ${domain.environment}\n`
      message += `   📅 Created: ${new Date(domain.created_on).toLocaleString()}\n\n`
    })

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error listing worker domains:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan dengan Cloudflare API: " + error.message)
  }
}

async function addWorkerDomain(chatId, domain) {
  try {
    if (!isValidDomain(domain)) {
      await sendTelegramMessage(chatId, "⚠️ Format domain tidak valid. Contoh: cache.netflix.com")
      return
    }

    const fullDomain = `${domain}.${CONFIG.BASE_DOMAIN}`
    const existingDomains = await getWorkerDomains()
    const domainExists = existingDomains.some((d) => d.hostname === fullDomain)

    if (domainExists) {
      await sendTelegramMessage(chatId, "⚠️ Worker domain sudah ada: " + fullDomain)
      return
    }

    await registerWorkerDomain(domain)

    await sendTelegramMessage(
      chatId,
      `✅ **Worker domain berhasil ditambahkan!**

🔗 **Domain:** \`${fullDomain}\`
🎯 **Worker:** ${CONFIG.WORKER_NAME}
🌍 **Environment:** production
📅 **Created:** ${new Date().toLocaleString()}

🌐 **Domain sekarang dapat diakses:**
https://${fullDomain}

✅ **Domain langsung aktif dan terintegrasi dengan worker!**`,
    )
  } catch (error) {
    console.error("Error adding worker domain:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan dengan Cloudflare API: " + error.message)
  }
}

async function deleteWorkerDomain(chatId, domain) {
  try {
    const fullDomain = `${domain}.${CONFIG.BASE_DOMAIN}`
    await unregisterWorkerDomain(domain)

    await sendTelegramMessage(
      chatId,
      `✅ **Worker domain berhasil dihapus!**

🔗 **Domain:** \`${fullDomain}\`
🗑️ **Status:** Deleted
📅 **Removed:** ${new Date().toLocaleString()}

❌ **Domain tidak lagi dapat diakses:**
https://${fullDomain}`,
    )
  } catch (error) {
    console.error("Error deleting worker domain:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan dengan Cloudflare API: " + error.message)
  }
}

async function checkWorkerDomainStatus(chatId) {
  try {
    const domains = await getWorkerDomains()
    const filteredDomains = domains.filter((d) => d.hostname.includes(CONFIG.BASE_DOMAIN))

    if (filteredDomains.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada worker domains untuk dicek.")
      return
    }

    let message = "🔍 **Status Worker Domains:**\n\n"

    for (const domain of filteredDomains) {
      const pingResult = await pingDomain(domain.hostname)
      const status = pingResult.success ? "🟢 Online" : "🔴 Offline"

      message += `**${domain.hostname}**\n`
      message += `🔧 Status: ${status}\n`
      message += `🎯 Service: ${domain.service}\n`
      message += `🆔 ID: \`${domain.id}\`\n`

      if (pingResult.success) {
        message += `⚡ Ping: ${pingResult.latency}ms\n`
      } else {
        message += `❌ Error: ${pingResult.error}\n`
      }
      message += "\n"
    }

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error checking worker domain status:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan dengan Cloudflare API: " + error.message)
  }
}

async function handleListWildcard(chatId) {
  try {
    const domains = await getWorkerDomains()
    const filteredDomains = domains.filter((d) => d.hostname.includes(CONFIG.BASE_DOMAIN))

    if (filteredDomains.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada custom domains yang terdaftar.")
      return
    }

    let message = "🌐 **List Custom Domains:**\n\n"
    filteredDomains.forEach((domain, index) => {
      message += `${index + 1}. \`${domain.hostname}\`\n`
    })

    message += `\n📊 **Total:** ${filteredDomains.length} domains`
    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error listing custom domains:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil daftar domains.")
  }
}

// ==========================================
// WILDCARD DOMAIN REQUEST SYSTEM
// ==========================================

async function handleWildcardCommand(message) {
  const chatId = message.chat.id
  const parts = message.text.split(" ")
  const command = parts[1]?.toLowerCase()
  const domain = parts[2]

  if (command === "add") {
    if (domain) {
      await handleWildcardRequest(chatId, domain, message.from)
    } else {
      await sendTelegramMessage(chatId, "⚠️ Gunakan format: /wildcard add <domain>\nContoh: /wildcard add facebook.com")
    }
  } else {
    await sendTelegramMessage(
      chatId,
      `⚠️ Command tidak dikenal. Gunakan:
- /wildcard add <domain> - Request custom domain (butuh approval admin)`,
    )
  }
}

async function handleWildcardRequest(chatId, domain, user) {
  try {
    if (!isValidDomain(domain)) {
      await sendTelegramMessage(chatId, "⚠️ Format domain tidak valid. Contoh: facebook.com")
      return
    }

    const fullDomain = `${domain}.${CONFIG.BASE_DOMAIN}`

    // Check if domain already exists
    try {
      const existingDomains = await getWorkerDomains()
      const domainExists = existingDomains.some((d) => d.hostname === fullDomain)

      if (domainExists) {
        await sendTelegramMessage(chatId, "⚠️ Domain sudah ada: " + fullDomain)
        return
      }
    } catch (error) {
      // If API error, still allow request but mention it in admin notification
    }

    // Check if request already pending
    const requestId = `${chatId}_${domain}`
    if (pendingDomainRequests.has(requestId)) {
      await sendTelegramMessage(chatId, "⚠️ Request untuk domain ini sudah pending approval admin.")
      return
    }

    // Store pending request
    const requestData = {
      id: requestId,
      chatId: chatId,
      domain: domain,
      fullDomain: fullDomain,
      user: user,
      timestamp: new Date().toISOString(),
    }

    pendingDomainRequests.set(requestId, requestData)
    addToRequestHistory(requestData, "pending")

    // Send confirmation to user
    await sendTelegramMessage(
      chatId,
      `✅ **Request domain berhasil dikirim!**

🔗 **Domain:** \`${fullDomain}\`
👤 **Requester:** ${user.first_name} ${user.last_name || ""}
📅 **Time:** ${new Date().toLocaleString()}

⏳ **Status:** Menunggu approval admin
📬 **Admin akan dinotifikasi untuk approve/reject request Anda**

💡 **Tip:** Anda akan mendapat notifikasi ketika admin memproses request ini.`,
    )

    // Send notification to all admins
    await notifyAdminsForApproval(requestData)
  } catch (error) {
    console.error("Error handling wildcard request:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat memproses request.")
  }
}

async function notifyAdminsForApproval(requestData) {
  const { id, chatId, domain, fullDomain, user, timestamp } = requestData

  const adminMessage = `🔔 **New Domain Request**

📋 **Request Details:**
🔗 **Domain:** \`${fullDomain}\`
👤 **User:** ${user.first_name} ${user.last_name || ""} (\`${user.id}\`)
💬 **Chat ID:** \`${chatId}\`
📅 **Time:** ${new Date(timestamp).toLocaleString()}

⚠️ **Action Required:** Approve atau Reject request ini?`

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `approve_domain|${id}` },
        { text: "❌ Reject", callback_data: `reject_domain|${id}` },
      ],
      [{ text: "📋 View Details", callback_data: `view_domain|${id}` }],
    ],
  }

  // Send to all admins
  for (const adminChatId of CONFIG.ADMIN_CHAT_IDS) {
    try {
      await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: adminMessage,
          parse_mode: "Markdown",
          reply_markup: inlineKeyboard,
        }),
      })
    } catch (error) {
      console.error(`Error sending notification to admin ${adminChatId}:`, error)
    }
  }
}

async function handleDomainApproval(callbackQuery) {
  const [action, requestId] = callbackQuery.data.split("|")
  const adminChatId = callbackQuery.message.chat.id

  // Check if admin
  if (!isAdmin(adminChatId)) {
    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
        text: "❌ Anda tidak memiliki akses admin!",
        show_alert: true,
      }),
    })
    return
  }

  const requestData = pendingDomainRequests.get(requestId)
  if (!requestData) {
    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
        text: "❌ Request tidak ditemukan atau sudah diproses!",
        show_alert: true,
      }),
    })
    return
  }

  const { chatId, domain, fullDomain, user } = requestData

  if (action === "approve_domain") {
    await processDomainApproval(callbackQuery, requestData, adminChatId)
  } else if (action === "reject_domain") {
    await processDomainRejection(callbackQuery, requestData, adminChatId)
  } else if (action === "view_domain") {
    await showDomainDetails(callbackQuery, requestData)
  }
}

async function processDomainApproval(callbackQuery, requestData, adminChatId) {
  const { id, chatId, domain, fullDomain, user } = requestData

  try {
    await registerWorkerDomain(domain)
    pendingDomainRequests.delete(id)
    addToRequestHistory(requestData, "approved", new Date().toISOString())

    // Notify user
    await sendTelegramMessage(
      chatId,
      `🎉 **Domain Request APPROVED!**

✅ **Domain:** \`${fullDomain}\`
🎯 **Status:** Aktif dan siap digunakan
📅 **Approved:** ${new Date().toLocaleString()}

🌐 **Domain sekarang dapat diakses:**
https://${fullDomain}

✨ **Terima kasih telah menggunakan layanan kami!**`,
    )

    // Update admin message
    await fetch(`${TELEGRAM_API_URL}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        message_id: callbackQuery.message.message_id,
        text: `✅ **APPROVED** - Domain Request

📋 **Request Details:**
🔗 **Domain:** \`${fullDomain}\`
👤 **User:** ${user.first_name} ${user.last_name || ""} (\`${user.id}\`)
💬 **Chat ID:** \`${chatId}\`
📅 **Approved:** ${new Date().toLocaleString()}
👨‍💼 **Approved by:** Admin

✅ **Status:** Domain berhasil ditambahkan dan aktif!`,
        parse_mode: "Markdown",
      }),
    })

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
        text: "✅ Domain approved dan berhasil ditambahkan!",
      }),
    })
  } catch (error) {
    console.error("Error approving domain:", error)

    await sendTelegramMessage(
      chatId,
      `❌ **Domain Request FAILED**

🔗 **Domain:** \`${fullDomain}\`
❌ **Error:** ${error.message}
📅 **Time:** ${new Date().toLocaleString()}

⚠️ **Mohon hubungi admin untuk bantuan lebih lanjut.**`,
    )

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
        text: "❌ Error saat menambahkan domain: " + error.message,
        show_alert: true,
      }),
    })
  }
}

async function processDomainRejection(callbackQuery, requestData, adminChatId) {
  const { id, chatId, fullDomain, user } = requestData

  pendingDomainRequests.delete(id)
  addToRequestHistory(requestData, "rejected", new Date().toISOString(), "Rejected by admin")

  // Notify user
  await sendTelegramMessage(
    chatId,
    `❌ **Domain Request REJECTED**

🔗 **Domain:** \`${fullDomain}\`
❌ **Status:** Ditolak oleh admin
📅 **Time:** ${new Date().toLocaleString()}

💡 **Saran:**
- Pastikan domain yang direquest sesuai dengan kebijakan
- Hubungi admin jika ada pertanyaan
- Anda bisa request domain lain yang sesuai`,
  )

  // Update admin message
  await fetch(`${TELEGRAM_API_URL}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: adminChatId,
      message_id: callbackQuery.message.message_id,
      text: `❌ **REJECTED** - Domain Request

📋 **Request Details:**
🔗 **Domain:** \`${fullDomain}\`
👤 **User:** ${user.first_name} ${user.last_name || ""} (\`${user.id}\`)
💬 **Chat ID:** \`${chatId}\`
📅 **Rejected:** ${new Date().toLocaleString()}
👨‍💼 **Rejected by:** Admin

❌ **Status:** Request ditolak`,
      parse_mode: "Markdown",
    }),
  })

  await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: "❌ Domain request rejected",
    }),
  })
}

async function showDomainDetails(callbackQuery, requestData) {
  const { fullDomain, user, chatId, timestamp } = requestData

  const detailMessage = `📋 **Domain Request Details**

🔗 **Domain:** \`${fullDomain}\`
👤 **User Info:**
   - Name: ${user.first_name} ${user.last_name || ""}
   - ID: \`${user.id}\`
   - Username: ${user.username ? "@" + user.username : "N/A"}
💬 **Chat ID:** \`${chatId}\`
📅 **Request Time:** ${new Date(timestamp).toLocaleString()}
⏳ **Status:** Pending Approval

🔧 **Actions Available:**
- ✅ Approve: Domain akan ditambahkan
- ❌ Reject: Request akan ditolak`

  await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: detailMessage,
      show_alert: true,
    }),
  })
}

// ==========================================
// DOMAIN REQUEST HISTORY SYSTEM
// ==========================================

async function handleRequestHistoryCommand(message) {
  const chatId = message.chat.id
  const parts = message.text.split(" ")
  const command = parts[1]?.toLowerCase()
  const limit = Number.parseInt(parts[2]) || 10

  if (isAdmin(chatId)) {
    const adminCommands = {
      all: () => showAllRequestHistory(chatId, limit),
      pending: () => showPendingRequests(chatId),
      approved: () => showApprovedRequests(chatId, limit),
      rejected: () => showRejectedRequests(chatId, limit),
      user: () => {
        const userId = parts[2]
        if (userId) {
          showUserRequestHistory(chatId, userId, limit)
        } else {
          sendTelegramMessage(chatId, "⚠️ Gunakan format: /history user <user_id>")
        }
      },
    }

    if (adminCommands[command]) {
      await adminCommands[command]()
    } else {
      await sendTelegramMessage(
        chatId,
        `📋 **Admin History Commands:**

🔍 **Available Commands:**
• \`/history all [limit]\` - Semua request history (default: 10)
• \`/history pending\` - Request yang masih pending
• \`/history approved [limit]\` - Request yang sudah approved
• \`/history rejected [limit]\` - Request yang ditolak
• \`/history user <user_id> [limit]\` - History user tertentu

💡 **Contoh:**
• \`/history all 20\` - 20 request terakhir
• \`/history user 123456789\` - History user ID 123456789`,
      )
    }
  } else {
    await showUserOwnHistory(chatId, limit)
  }
}

// History Helper Functions
function getStatusEmoji(status) {
  const statusEmojis = {
    pending: "⏳",
    approved: "✅",
    rejected: "❌",
  }
  return statusEmojis[status] || "❓"
}

function getTimeAgo(timestamp) {
  const now = new Date()
  const time = new Date(timestamp)
  const diffMs = now - time
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return time.toLocaleDateString()
}

function addToRequestHistory(requestData, status, processedAt = null, rejectionReason = null) {
  const historyEntry = {
    ...requestData,
    status: status,
    processedAt: processedAt,
    rejectionReason: rejectionReason,
  }
  domainRequestHistory.set(requestData.id, historyEntry)
}

// History Display Functions
async function showAllRequestHistory(chatId, limit) {
  try {
    const allHistory = Array.from(domainRequestHistory.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)

    if (allHistory.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada history request domain.")
      return
    }

    let message = `📋 **All Domain Request History** (${limit} terakhir)\n\n`

    allHistory.forEach((request, index) => {
      const statusEmoji = getStatusEmoji(request.status)
      const timeAgo = getTimeAgo(request.timestamp)

      message += `${index + 1}. ${statusEmoji} **${request.domain}**\n`
      message += `   👤 User: ${request.user.first_name} (${request.user.id})\n`
      message += `   📅 ${timeAgo}\n`
      if (request.status !== "pending") {
        message += `   ⚡ Processed: ${getTimeAgo(request.processedAt)}\n`
      }
      message += `\n`
    })

    const stats = {
      total: allHistory.length,
      pending: allHistory.filter((r) => r.status === "pending").length,
      approved: allHistory.filter((r) => r.status === "approved").length,
      rejected: allHistory.filter((r) => r.status === "rejected").length,
    }

    message += `📊 **Summary:**\n`
    message += `• Total: ${stats.total} requests\n`
    message += `• Pending: ${stats.pending}\n`
    message += `• Approved: ${stats.approved}\n`
    message += `• Rejected: ${stats.rejected}`

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing all request history:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil history.")
  }
}

async function showPendingRequests(chatId) {
  try {
    const pendingRequests = Array.from(pendingDomainRequests.values()).sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    )

    if (pendingRequests.length === 0) {
      await sendTelegramMessage(chatId, "✅ Tidak ada request yang pending saat ini.")
      return
    }

    let message = `⏳ **Pending Domain Requests** (${pendingRequests.length})\n\n`

    pendingRequests.forEach((request, index) => {
      const timeAgo = getTimeAgo(request.timestamp)

      message += `${index + 1}. 🔄 **${request.domain}**\n`
      message += `   👤 User: ${request.user.first_name} (${request.user.id})\n`
      message += `   💬 Chat: ${request.chatId}\n`
      message += `   📅 Requested: ${timeAgo}\n`
      message += `   🔗 Full: \`${request.fullDomain}\`\n\n`
    })

    message += `⚠️ **Action Required:** ${pendingRequests.length} requests menunggu approval`
    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing pending requests:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil pending requests.")
  }
}

async function showApprovedRequests(chatId, limit) {
  try {
    const approvedRequests = Array.from(domainRequestHistory.values())
      .filter((r) => r.status === "approved")
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, limit)

    if (approvedRequests.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada request yang approved.")
      return
    }

    let message = `✅ **Approved Domain Requests** (${limit} terakhir)\n\n`

    approvedRequests.forEach((request, index) => {
      const timeAgo = getTimeAgo(request.processedAt)

      message += `${index + 1}. ✅ **${request.domain}**\n`
      message += `   👤 User: ${request.user.first_name} (${request.user.id})\n`
      message += `   📅 Approved: ${timeAgo}\n`
      message += `   🌐 Active: \`${request.fullDomain}\n\n`
    })

    message += `📊 **Total Approved:** ${approvedRequests.length} domains`
    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing approved requests:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil approved requests.")
  }
}

async function showRejectedRequests(chatId, limit) {
  try {
    const rejectedRequests = Array.from(domainRequestHistory.values())
      .filter((r) => r.status === "rejected")
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, limit)

    if (rejectedRequests.length === 0) {
      await sendTelegramMessage(chatId, "📝 Tidak ada request yang rejected.")
      return
    }

    let message = `❌ **Rejected Domain Requests** (${limit} terakhir)\n\n`

    rejectedRequests.forEach((request, index) => {
      const timeAgo = getTimeAgo(request.processedAt)

      message += `${index + 1}. ❌ **${request.domain}**\n`
      message += `   👤 User: ${request.user.first_name} (${request.user.id})\n`
      message += `   📅 Rejected: ${timeAgo}\n`
      message += `   💭 Reason: ${request.rejectionReason || "No reason provided"}\n\n`
    })

    message += `📊 **Total Rejected:** ${rejectedRequests.length} requests`
    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing rejected requests:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil rejected requests.")
  }
}

async function showUserRequestHistory(chatId, userId, limit) {
  try {
    const userHistory = Array.from(domainRequestHistory.values())
      .filter((r) => r.user.id.toString() === userId.toString())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)

    if (userHistory.length === 0) {
      await sendTelegramMessage(chatId, `📝 Tidak ada history untuk user ID: ${userId}`)
      return
    }

    const user = userHistory[0].user
    let message = `👤 **Request History for ${user.first_name}** (ID: ${userId})\n\n`

    userHistory.forEach((request, index) => {
      const statusEmoji = getStatusEmoji(request.status)
      const timeAgo = getTimeAgo(request.timestamp)

      message += `${index + 1}. ${statusEmoji} **${request.domain}**\n`
      message += `   📅 Requested: ${timeAgo}\n`
      if (request.status !== "pending") {
        message += `   ⚡ Processed: ${getTimeAgo(request.processedAt)}\n`
      }
      message += `\n`
    })

    const stats = {
      total: userHistory.length,
      pending: userHistory.filter((r) => r.status === "pending").length,
      approved: userHistory.filter((r) => r.status === "approved").length,
      rejected: userHistory.filter((r) => r.status === "rejected").length,
    }

    message += `📊 **User Statistics:**\n`
    message += `• Total Requests: ${stats.total}\n`
    message += `• Pending: ${stats.pending}\n`
    message += `• Approved: ${stats.approved}\n`
    message += `• Rejected: ${stats.rejected}\n`

    if (stats.approved + stats.rejected > 0) {
      const successRate = Math.round((stats.approved / (stats.approved + stats.rejected)) * 100)
      message += `• Success Rate: ${successRate}%`
    }

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing user request history:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil user history.")
  }
}

async function showUserOwnHistory(chatId, limit) {
  try {
    const userHistory = Array.from(domainRequestHistory.values())
      .filter((r) => r.chatId.toString() === chatId.toString())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)

    if (userHistory.length === 0) {
      await sendTelegramMessage(chatId, "📝 Anda belum pernah request domain.")
      return
    }

    let message = `📋 **Your Domain Request History** (${limit} terakhir)\n\n`

    userHistory.forEach((request, index) => {
      const statusEmoji = getStatusEmoji(request.status)
      const timeAgo = getTimeAgo(request.timestamp)

      message += `${index + 1}. ${statusEmoji} **${request.domain}**\n`
      message += `   📅 Requested: ${timeAgo}\n`

      if (request.status === "approved") {
        message += `   ✅ Approved: ${getTimeAgo(request.processedAt)}\n`
        message += `   🌐 Active: https://${request.fullDomain}\n`
      } else if (request.status === "rejected") {
        message += `   ❌ Rejected: ${getTimeAgo(request.processedAt)}\n`
        message += `   💭 Reason: ${request.rejectionReason || "No reason provided"}\n`
      } else {
        message += `   ⏳ Status: Pending approval\n`
      }
      message += `\n`
    })

    const stats = {
      total: userHistory.length,
      pending: userHistory.filter((r) => r.status === "pending").length,
      approved: userHistory.filter((r) => r.status === "approved").length,
      rejected: userHistory.filter((r) => r.status === "rejected").length,
    }

    message += `📊 **Your Statistics:**\n`
    message += `• Total Requests: ${stats.total}\n`
    message += `• Pending: ${stats.pending}\n`
    message += `• Approved: ${stats.approved}\n`
    message += `• Rejected: ${stats.rejected}`

    if (stats.approved + stats.rejected > 0) {
      const successRate = Math.round((stats.approved / (stats.approved + stats.rejected)) * 100)
      message += `\n• Success Rate: ${successRate}%`
    }

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error showing user own history:", error)
    await sendTelegramMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil history Anda.")
  }
}

// ==========================================
// PROXY CHECKER & IP FUNCTIONS
// ==========================================

async function handleGetRandomIPCommand(chatId) {
  try {
    const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
    const data = await response.text()
    const proxyList = data.split("\n").filter((line) => line.trim() !== "")

    const randomIPs = Utils.getRandomItems(proxyList, 20)
    const message =
      `🔑 **Here are 20 random Proxy IPs:**\n\n` +
      randomIPs
        .map((ip) => {
          const [ipAddress, port, country, provider] = ip.split(",")
          const formattedProvider = provider.replace(/\./g, " ")
          return `📍**IP:PORT : **\`${ipAddress}:${port}\`**\n🌍 **Country :** ${country}\n💻 **ISP :** ${formattedProvider}\n`
        })
        .join("\n")

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error fetching proxy list:", error)
    await sendTelegramMessage(chatId, "⚠️ There was an error fetching the Proxy list. Please try again later.")
  }
}

async function handleGetRandomCountryCommand(chatId, countryId) {
  try {
    const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
    const data = await response.text()
    const proxyList = data.split("\n").filter((line) => line.trim() !== "")

    const filteredProxies = proxyList.filter((ip) => {
      const [, , country] = ip.split(",")
      return country.toUpperCase() === countryId.toUpperCase()
    })

    if (filteredProxies.length === 0) {
      await sendTelegramMessage(chatId, `⚠️ No proxies found for country code **${countryId}**.`)
      return
    }

    const randomIPs = Utils.getRandomItems(filteredProxies, 20)
    const message =
      `🔑 **Here are 20 random Proxy IPs for country ${countryId}:**\n\n` +
      randomIPs
        .map((ip) => {
          const [ipAddress, port, country, provider] = ip.split(",")
          const formattedProvider = provider.replace(/\./g, " ")
          return `📍**IP:PORT : **\`${ipAddress}:${port}\`**\n🌍 **Country :** ${country}\n💻 **ISP :** ${formattedProvider}\n`
        })
        .join("\n")

    await sendTelegramMessage(chatId, message)
  } catch (error) {
    console.error("Error fetching proxy list:", error)
    await sendTelegramMessage(chatId, "⚠️ There was an error fetching the Proxy list. Please try again later.")
  }
}

async function handleIPPortCheck(ipPortText, chatId, hostname) {
  const normalizedText = ipPortText.replace(/\n/g, ",").replace(/\s+/g, "")
  const ipPortList = normalizedText.split(",")

  for (const ipPort of ipPortList) {
    const [ip, port] = ipPort.trim().split(":")

    if (Utils.isValidIPPortFormat(ipPort.trim())) {
      await checkIPPort(ip, port, chatId, hostname)
    } else {
      await sendTelegramMessage(chatId, `⚠️ Format ip:port tidak valid: ${ipPort.trim()}`)
    }
  }
}

async function checkIPPort(ip, port, chatId, hostname) {
  try {
    const response = await fetch(`${CONFIG.API_CHECK}${ip}:${port}`)
    if (!response.ok) throw new Error(`Error: ${response.statusText}`)

    const data = await response.json()

    // API baru mengembalikan array, ambil elemen pertama
    const result = Array.isArray(data) ? data[0] : data

    const {
      proxy,
      port: p,
      org,
      country = "Unknown",
      flag = "🏳️",
      latency,
    } = result

    // Filter ISP untuk hanya menyisakan huruf, angka, dan spasi
    const cleanISP = org ? org.replace(/[^a-zA-Z0-9\s]/g, "").trim() : "Unknown"

    const status = result.proxyip ? "✅ Active" : "❌ NON-Active"

    const resultMessage = `🌍 **IP & Port Check Result**:
━━━━━━━━━━━━━━━━━━━━━━━
📡 **IP**: ${proxy}
🔌 **Port**: ${p}
💻 **ISP**: ${cleanISP}
🌏 **Country**: ${country} ${flag}
🚦 **Status**: ${status}
⚡ **Latency**: ${latency}
━━━━━━━━━━━━━━━━━━━━━━━

[Incognito Mode](${CONFIG.OWNER})`

    await sendTelegramMessage(chatId, resultMessage)
    await sendInlineKeyboard(chatId, proxy, p, cleanISP, flag)
  } catch (error) {
    await sendTelegramMessage(chatId, `⚠️ Error: ${error.message}`)
  }
}

async function sendInlineKeyboard(chatId, ip, port, isp, flag) {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Pilih opsi berikut untuk membuat VPN Tunnel:",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Create VLESS", callback_data: `create_vless|${ip}|${port}|${isp}|${flag}` },
              { text: "Create Trojan", callback_data: `create_trojan|${ip}|${port}|${isp}|${flag}` },
            ],
            [{ text: "Create ShadowSocks", callback_data: `create_ss|${ip}|${port}|${isp}|${flag}` }],
          ],
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Failed to send inline keyboard:", errorText)
    }
  } catch (error) {
    console.error("Error sending inline keyboard:", error)
  }
}

// ==========================================
// VPN GENERATOR FUNCTIONS
// ==========================================

async function handleVlessCreation(chatId, ip, port, isp, hostBot) {
  const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
  const vlname = `${isp}-[Tls]-[VL]-[${CONFIG.WATERMARK}]`
  const vlname2 = `${isp}-[NTls]-[VL]-[${CONFIG.WATERMARK}]`
  const uuid = Utils.generateUUIDv4()

  const vlessTLS = `vless://${uuid}@${hostBot}:443?path=${encodeURIComponent(path)}&security=tls&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(vlname)}`
  const vlessNTLS = `vless://${uuid}@${hostBot}:80?path=${encodeURIComponent(path)}&security=none&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(vlname2)}`

  const proxiesConfig = `proxies:
- name: ${vlname}
  server: ${hostBot}
  port: 443
  type: vless
  uuid: ${uuid}
  tls: true
  network: ws
  servername: ${hostBot}
  ws-opts:
    path: ${path}
    headers:
      Host: ${hostBot}`

  const message = `⚜️ Success Create VLESS ⚜️

Type : VLESS 
ISP : \`${isp}\`
ProxyIP : \`${ip}:${port}\` 

🔗 **Links Vless** :
1️⃣ **TLS** : \`${vlessTLS}\`
2️⃣ **Non-TLS** : \`${vlessNTLS}\`

📄 **Proxies Config** :
\`\`\`
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

  await sendTelegramMessage(chatId, message)
}

async function handleTrojanCreation(chatId, ip, port, isp, hostBot) {
  const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
  const trname = `${isp}-[Tls]-[TR]-[${CONFIG.WATERMARK}]`
  const trname2 = `${isp}-[NTls]-[TR]-[${CONFIG.WATERMARK}]`
  const uuid = Utils.generateUUIDv4()

  const trojanTLS = `trojan://${uuid}@${hostBot}:443?path=${encodeURIComponent(path)}&security=tls&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(trname)}`
  const trojanNTLS = `trojan://${uuid}@${hostBot}:80?path=${encodeURIComponent(path)}&security=none&host=${hostBot}&type=ws&sni=${hostBot}#${encodeURIComponent(trname2)}`

  const proxiesConfig = `proxies:
- name: ${trname}
  server: ${hostBot}
  port: 443
  type: trojan
  password: ${uuid}
  tls: true
  udp: false
  network: ws
  sni: ${hostBot}
  ws-opts:
    path: ${path}
    headers:
        Host: ${hostBot}`

  const message = `⚜️ Success Create Trojan ⚜️

Type : Trojan 
ISP : \`${isp}\`
ProxyIP : \`${ip}:${port}\` 

🔗 **Links Trojan** :
1️⃣ **TLS** : \`${trojanTLS}\`
2️⃣ **Non-TLS** : \`${trojanNTLS}\`

📄 **Proxies Config** :
\`\`\`
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

  await sendTelegramMessage(chatId, message)
}

async function handleShadowSocksCreation(chatId, ip, port, isp, hostBot) {
  const path = `/${CONFIG.PATH_INFO}/${ip}/${port}`
  const ssname = `${isp}-[Tls]-[SS]-[${CONFIG.WATERMARK}]`
  const ssname2 = `${isp}-[NTls]-[SS]-[${CONFIG.WATERMARK}]`
  const uuid = Utils.generateUUIDv4()

  const ssTls = `ss://${btoa(`none:${uuid}`)}@${hostBot}:443?plugin=v2ray-plugin;tls;mux=0;mode=websocket;path=${encodeURIComponent(path)};host=${hostBot}#${encodeURIComponent(ssname)}`
  const ssNTls = `ss://${btoa(`none:${uuid}`)}@${hostBot}:80?plugin=v2ray-plugin;mux=0;mode=websocket;path=${encodeURIComponent(path)};host=${hostBot}#${encodeURIComponent(ssname2)}`

  const proxiesConfig = `proxies:
- name: ${ssname}
  server: ${hostBot}
  port: 443
  type: ss
  password: ${uuid}
  plugin: v2ray-plugin
  cipher: none
  udp: false
  plugin-opts:
    mode: websocket
    host: ${hostBot}
    path: ${path}
    tls: true
    mux: false`

  const message = `⚜️ Success Create ShadowSocks ⚜️

Type : ShadowSocks 
ISP : \`${isp}\`
ProxyIP : \`${ip}:${port}\` 

🔗 **Links Vless** :
1️⃣ **TLS** : \`${ssTls}\`
2️⃣ **Non-TLS** : \`${ssNTls}\`

📄 **Proxies Config**:
\`\`\`
${proxiesConfig}
\`\`\`
[NoirR](${CONFIG.OWNER})`

  await sendTelegramMessage(chatId, message)
}

// ==========================================
// PROXY MANAGEMENT FUNCTIONS
// ==========================================

async function getProxyList(env, forceReload = false) {
  try {
    if (!cachedProxyList.length || forceReload) {
      const proxyBankUrl = env?.PROXY_BANK_URL || CONFIG.DEFAULT_PROXY_BANK_URL
      const response = await fetch(proxyBankUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch proxy list: ${response.status}`)
      }

      const proxyLines = (await response.text()).split("\n").filter(Boolean)
      cachedProxyList = proxyLines.map((line) => {
        const [proxyIP, proxyPort, country, org] = line.split(",")
        return { proxyIP, proxyPort, country, org }
      })
    }

    return cachedProxyList
  } catch (error) {
    console.error("Error fetching proxy list:", error)
    return []
  }
}

async function getProxyIP(cleanPath, env) {
  const pathMatch = cleanPath.match(/^([A-Z]{2})(\d+)?$/)
  if (pathMatch) {
    const countryCode = pathMatch[1]
    const index = pathMatch[2] ? Number.parseInt(pathMatch[2], 10) - 1 : null
    const proxies = await getProxyList(env)
    const filteredProxies = proxies.filter((proxy) => proxy.country === countryCode)

    if (filteredProxies.length === 0) return null

    const selectedProxy = index === null ? proxyState.get(countryCode) || filteredProxies[0] : filteredProxies[index]
    return `${selectedProxy.proxyIP}:${selectedProxy.proxyPort}`
  }

  const ipPortMatch = cleanPath.match(/^(.+[^.\d\w]\d+)$/)
  if (ipPortMatch) {
    return ipPortMatch[1].replace(/[^.\d\w]+/g, ":")
  }

  return null
}

// ==========================================
// WEBSOCKET HANDLER FUNCTIONS
// ==========================================

async function websocketHandler(request, proxyIP) {
  const webSocketPair = new WebSocketPair()
  const [client, webSocket] = Object.values(webSocketPair)

  webSocket.accept()

  let addressLog = ""
  let portLog = ""
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "")
  }

  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || ""
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log)

  const remoteSocketWrapper = { value: null }
  let udpStreamWrite = null
  let isDNS = false

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS && udpStreamWrite) {
            return udpStreamWrite(chunk)
          }

          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter()
            await writer.write(chunk)
            writer.releaseLock()
            return
          }

          const protocol = await protocolSniffer(chunk)
          const protocolHeader = parseProtocolHeader(protocol, chunk)

          addressLog = protocolHeader.addressRemote
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message)
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true
            } else {
              throw new Error("UDP only support for DNS port 53")
            }
          }

          if (isDNS) {
            const { write } = await handleUDPOutbound(webSocket, protocolHeader.version, log)
            udpStreamWrite = write
            udpStreamWrite(protocolHeader.rawClientData)
            return
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log,
            proxyIP,
          )
        },
        close() {
          log(`readableWebSocketStream is close`)
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason))
        },
      }),
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err)
    })

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) return
        controller.enqueue(event.data)
      })

      webSocketServer.addEventListener("close", () => {
        Utils.safeCloseWebSocket(webSocketServer)
        if (readableStreamCancel) return
        controller.close()
      })

      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error")
        controller.error(err)
      })

      const { earlyData, error } = Utils.base64ToArrayBuffer(earlyDataHeader)
      if (error) {
        controller.error(error)
      } else if (earlyData) {
        controller.enqueue(earlyData)
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) return
      log(`ReadableStream was canceled, due to ${reason}`)
      readableStreamCancel = true
      Utils.safeCloseWebSocket(webSocketServer)
    },
  })

  return stream
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const trojanDelimiter = new Uint8Array(buffer.slice(56, 60))
    if (trojanDelimiter[0] === 0x0d && trojanDelimiter[1] === 0x0a) {
      if (trojanDelimiter[2] === 0x01 || trojanDelimiter[2] === 0x03 || trojanDelimiter[2] === 0x7f) {
        if (trojanDelimiter[3] === 0x01 || trojanDelimiter[3] === 0x03 || trojanDelimiter[3] === 0x04) {
          return "Trojan"
        }
      }
    }
  }

  const vlessDelimiter = new Uint8Array(buffer.slice(1, 17))
  if (Utils.arrayBufferToHex(vlessDelimiter).match(/^\w{8}\w{4}4\w{3}[89ab]\w{3}\w{12}$/)) {
    return "VLESS"
  }

  return "Shadowsocks"
}

function parseProtocolHeader(protocol, chunk) {
  const protocolParsers = {
    Trojan: parseTrojanHeader,
    VLESS: parseVlessHeader,
    Shadowsocks: parseShadowsocksHeader,
  }

  const parser = protocolParsers[protocol]
  if (!parser) {
    throw new Error("Unknown Protocol!")
  }

  return parser(chunk)
}

function parseShadowsocksHeader(ssBuffer) {
  const view = new DataView(ssBuffer)
  const addressType = view.getUint8(0)
  let addressLength = 0
  let addressValueIndex = 1
  let addressValue = ""

  switch (addressType) {
    case 1:
      addressLength = 4
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".")
      break
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]
      addressValueIndex += 1
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength))
      break
    case 4:
      addressLength = 16
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength))
      const ipv6 = []
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16))
      }
      addressValue = ipv6.join(":")
      break
    default:
      return {
        hasError: true,
        message: `Invalid addressType for Shadowsocks: ${addressType}`,
      }
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    }
  }

  const portIndex = addressValueIndex + addressLength
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2)
  const portRemote = new DataView(portBuffer).getUint16(0)

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  }
}

function parseVlessHeader(vlessBuffer) {
  const version = new Uint8Array(vlessBuffer.slice(0, 1))
  let isUDP = false

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0]
  const cmd = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0]

  if (cmd === 1) {
    // TCP
  } else if (cmd === 2) {
    isUDP = true
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not support, command 01-tcp,02-udp,03-mux`,
    }
  }

  const portIndex = 18 + optLength + 1
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2)
  const portRemote = new DataView(portBuffer).getUint16(0)

  const addressIndex = portIndex + 2
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1))
  const addressType = addressBuffer[0]
  let addressLength = 0
  let addressValueIndex = addressIndex + 1
  let addressValue = ""

  switch (addressType) {
    case 1: // IPv4
      addressLength = 4
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".")
      break
    case 2: // Domain
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]
      addressValueIndex += 1
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength))
      break
    case 3: // IPv6
      addressLength = 16
      const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength))
      const ipv6 = []
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16))
      }
      addressValue = ipv6.join(":")
      break
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      }
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    }
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: vlessBuffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  }
}

function parseTrojanHeader(buffer) {
  const socks5DataBuffer = buffer.slice(58)
  if (socks5DataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid SOCKS5 request data",
    }
  }

  let isUDP = false
  const view = new DataView(socks5DataBuffer)
  const cmd = view.getUint8(0)

  if (cmd == 3) {
    isUDP = true
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!")
  }

  const addressType = view.getUint8(1)
  let addressLength = 0
  let addressValueIndex = 2
  let addressValue = ""

  switch (addressType) {
    case 1: // IPv4
      addressLength = 4
      addressValue = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(
        ".",
      )
      break
    case 3: // Domain
      addressLength = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]
      addressValueIndex += 1
      addressValue = new TextDecoder().decode(
        socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength),
      )
      break
    case 4: // IPv6
      addressLength = 16
      const dataView = new DataView(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength))
      const ipv6 = []
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16))
      }
      addressValue = ipv6.join(":")
      break
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      }
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    }
  }

  const portIndex = addressValueIndex + addressLength
  const portBuffer = socks5DataBuffer.slice(portIndex, portIndex + 2)
  const portRemote = new DataView(portBuffer).getUint16(0)

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: socks5DataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  }
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log,
  proxyIP,
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({ hostname: address, port: port })
    remoteSocket.value = tcpSocket
    log(`connected to ${address}:${port}`)
    const writer = tcpSocket.writable.getWriter()
    await writer.write(rawClientData)
    writer.releaseLock()
    return tcpSocket
  }

  async function retry() {
    const [proxyHost, proxyPort] = proxyIP.split(/[:=-]/)
    const tcpSocket = await connectAndWrite(proxyHost || addressRemote, proxyPort || portRemote)
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error)
      })
      .finally(() => {
        Utils.safeCloseWebSocket(webSocket)
      })
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log)
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote)
  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log)
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader
  let hasIncomingData = false

  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true
          if (webSocket.readyState !== CONFIG.WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close")
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer())
            header = null
          } else {
            webSocket.send(chunk)
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`)
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason)
        },
      }),
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error)
      Utils.safeCloseWebSocket(webSocket)
    })

  if (hasIncomingData === false && retry) {
    log(`retry`)
    retry()
  }
}

async function handleUDPOutbound(webSocket, responseHeader, log) {
  let isVlessHeaderSent = false
  const transformStream = new TransformStream({
    start(controller) {},
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2)
        const udpPaketLength = new DataView(lengthBuffer).getUint16(0)
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPaketLength))
        index = index + 2 + udpPaketLength
        controller.enqueue(udpData)
      }
    },
    flush(controller) {},
  })

  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch("https://1.1.1.1/dns-query", {
            method: "POST",
            headers: { "content-type": "application/dns-message" },
            body: chunk,
          })
          const dnsQueryResult = await resp.arrayBuffer()
          const udpSize = dnsQueryResult.byteLength
          const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff])

          if (webSocket.readyState === CONFIG.WS_READY_STATE_OPEN) {
            log(`doh success and dns message length is ${udpSize}`)
            if (isVlessHeaderSent) {
              webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer())
            } else {
              webSocket.send(await new Blob([responseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer())
              isVlessHeaderSent = true
            }
          }
        },
      }),
    )
    .catch((error) => {
      log("dns udp has error" + error)
    })

  const writer = transformStream.writable.getWriter()
  return {
    write(chunk) {
      writer.write(chunk)
    },
  }
}

// ==========================================
// SUBSCRIPTION GENERATOR FUNCTIONS
// ==========================================

async function generateClashSub(searchParams, hostname) {
  const type = searchParams.get("type") || "mix"
  const tls = searchParams.get("tls") !== "false"
  const wildcard = searchParams.get("wildcard") === "true"
  const bugs = searchParams.get("bug") || "cloudflare.com"
  const country = searchParams.get("country")
  const limit = Number.parseInt(searchParams.get("limit"), 10)
  const bugwildcard = wildcard ? `${bugs}.${hostname}` : hostname

  const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
  const proxyList = await response.text()
  let ips = proxyList.split("\n").filter(Boolean)

  if (country) {
    if (country.toLowerCase() === "random") {
      ips = ips.sort(() => Math.random() - 0.5)
    } else {
      ips = ips.filter((line) => {
        const parts = line.split(",")
        return parts.length > 1 && parts[2].toUpperCase() === country.toUpperCase()
      })
    }
  }

  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit)
  }

  let conf = ""
  let count = 1

  for (const line of ips) {
    const parts = line.split(",")
    const [proxyHost, proxyPort = 443, countryCode, isp] = parts
    const emojiFlag = Utils.getEmojiFlag(countryCode)
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim()
    const ispName = sanitize(`${emojiFlag} [${countryCode}] ${isp} ${count++}`)
    const uuid = Utils.generateUUIDv4()
    const ports = tls ? "443" : "80"
    const snio = tls ? `\n  servername: ${bugwildcard}` : ""
    const snioo = tls ? `\n  cipher: auto` : ""

    if (type === "vless" || type === "mix") {
      conf += `
- name: ${ispName}-[VL]-[${CONFIG.WATERMARK}]
  server: ${bugs}
  port: ${ports}
  type: vless
  uuid: ${uuid}${snioo}
  tls: ${tls}
  udp: false
  network: ws${snio}
  ws-opts:
    path: /${CONFIG.PATH_INFO}/${proxyHost}/${proxyPort}
    headers:
      Host: ${bugwildcard}
`
    }

    if (type === "trojan" || type === "mix") {
      conf += `
- name: ${ispName}-[TR]-[${CONFIG.WATERMARK}]
  server: ${bugs}
  port: 443
  type: trojan
  password: ${uuid}
  tls: true
  udp: false
  skip-cert-verify: true
  network: ws
  sni: ${bugwildcard}
  ws-opts:
    path: /${CONFIG.PATH_INFO}/${proxyHost}/${proxyPort}
    headers:
      Host: ${bugwildcard}
`
    }

    if (type === "shadowsocks" || type === "mix") {
      conf += `
- name: ${ispName}-[SS]-[${CONFIG.WATERMARK}]
  type: ss
  server: ${bugs}
  port: ${ports}
  cipher: none
  password: ${uuid}
  udp: false
  plugin: v2ray-plugin
  plugin-opts:
    mode: websocket
    tls: ${tls}
    host: ${bugwildcard}
    path: /${CONFIG.PATH_INFO}/${proxyHost}/${proxyPort}
    mux: false
`
    }
  }

  return `proxies:\n${conf}`
}

async function generateV2rayngSub(searchParams, hostname) {
  const type = searchParams.get("type") || "mix"
  const tls = searchParams.get("tls") !== "false"
  const wildcard = searchParams.get("wildcard") === "true"
  const bugs = searchParams.get("bug") || "cloudflare.com"
  const country = searchParams.get("country")
  const limit = Number.parseInt(searchParams.get("limit"), 10)
  const bugwildcard = wildcard ? `${bugs}.${hostname}` : hostname

  const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
  const proxyList = await response.text()
  let ips = proxyList.split("\n").filter(Boolean)

  if (country) {
    if (country.toLowerCase() === "random") {
      ips = ips.sort(() => 0.5 - Math.random())
    } else {
      ips = ips.filter((line) => {
        const parts = line.split(",")
        return parts.length > 1 && parts[2].toUpperCase() === country.toUpperCase()
      })
    }
  }

  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit)
  }

  function generateConfig(protocol, uuid, proxyHost, proxyPort, ispInfo) {
    const port = tls ? 443 : 80
    const sni = tls ? `&sni=${bugwildcard}` : ""
    const security = tls ? "&security=tls" : "&security=none"
    const basePath = `%2F${CONFIG.PATH_INFO}%2F${proxyHost}%2F${proxyPort}`
    const commonParams = `?encryption=none&type=ws&host=${bugwildcard}&path=${basePath}${security}${sni}`

    const configs = {
      vless: `vless://${uuid}@${bugs}:${port}${commonParams}&fp=randomized#${ispInfo}-[VL]-[${CONFIG.WATERMARK}]`,
      trojan: `trojan://${uuid}@${bugs}:${port}${commonParams}&fp=randomized#${ispInfo}-[TR]-[${CONFIG.WATERMARK}]`,
      shadowsocks: `ss://${btoa(`none:${uuid}`)}%3D@${bugs}:${port}${commonParams}#${ispInfo}-[SS]-[${CONFIG.WATERMARK}]`,
    }

    return configs[protocol] || ""
  }

  const conf = ips
    .map((line) => {
      const parts = line.split(",")
      const [proxyHost, proxyPort = 443, countryCode, isp] = parts
      const uuid = Utils.generateUUIDv4()
      const ispInfo = `[${countryCode}] ${isp}`

      if (type === "mix") {
        return ["vless", "trojan", "shadowsocks"]
          .map((proto) => generateConfig(proto, uuid, proxyHost, proxyPort, ispInfo))
          .join("\n")
      }
      return generateConfig(type, uuid, proxyHost, proxyPort, ispInfo)
    })
    .join("\n")

  return btoa(conf.replace(/ /g, "%20"))
}

async function generateV2raySub(searchParams, hostname) {
  const type = searchParams.get("type") || "mix"
  const tls = searchParams.get("tls") !== "false"
  const wildcard = searchParams.get("wildcard") === "true"
  const bugs = searchParams.get("bug") || "cloudflare.com"
  const country = searchParams.get("country")
  const limit = Number.parseInt(searchParams.get("limit"), 10)
  const bugwildcard = wildcard ? `${bugs}.${hostname}` : hostname

  const response = await fetch(CONFIG.DEFAULT_PROXY_BANK_URL)
  const proxyList = await response.text()
  let ips = proxyList.split("\n").filter(Boolean)

  if (country) {
    if (country.toLowerCase() === "random") {
      ips = ips.sort(() => Math.random() - 0.5)
    } else {
      ips = ips.filter((line) => {
        const parts = line.split(",")
        return parts.length > 1 && parts[2].toUpperCase() === country.toUpperCase()
      })
    }
  }

  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit)
  }

  return ips
    .map((line) => {
      const [proxyHost, proxyPort = 443, countryCode, isp] = line.split(",")
      const uuid = Utils.generateUUIDv4()
      const information = encodeURIComponent(`${Utils.getEmojiFlag(countryCode)} (${countryCode}) ${isp}`)
      const baseConfig = `${uuid}@${bugs}:${tls ? 443 : 80}?${tls ? "security=tls&sni" : "security=none&sni"}=${bugwildcard}&fp=randomized&type=ws&host=${bugwildcard}&path=%2F${CONFIG.PATH_INFO}%2F${proxyHost}%2F${proxyPort}`

      switch (type) {
        case "vless":
          return `vless://${baseConfig}#${information}-[VL]-[${CONFIG.WATERMARK}]`
        case "trojan":
          return `trojan://${baseConfig}#${information}-[TR]-[${CONFIG.WATERMARK}]`
        case "shadowsocks":
          return `ss://${btoa(`none:${uuid}`)}%3D@${bugs}:${tls ? 443 : 80}?encryption=none&type=ws&host=${bugwildcard}&path=%2F${CONFIG.PATH_INFO}%2F${proxyHost}%2F${proxyPort}&${tls ? "security=tls" : "security=none"}&sni=${bugwildcard}#${information}-[SS]-[${CONFIG.WATERMARK}]`
        case "mix":
          return [
            `vless://${baseConfig}#${information}-[VL]-[${CONFIG.WATERMARK}]`,
            `trojan://${baseConfig}#${information}-[TR]-[${CONFIG.WATERMARK}]`,
            `ss://${btoa(`none:${uuid}`)}%3D@${bugs}:${tls ? 443 : 80}?encryption=none&type=ws&host=${bugwildcard}&path=%2F${CONFIG.PATH_INFO}%2F${proxyHost}%2F${proxyPort}&${tls ? "security=tls" : "security=none"}&sni=${bugwildcard}#${information}-[SS]-[${CONFIG.WATERMARK}]`,
          ].join("\n")
      }
    })
    .join("\n")
}

// ==========================================
// MAIN WORKER EXPORT
// ==========================================

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url)
      const upgradeHeader = request.headers.get("Upgrade")
      const hostname = getHostname(request)

      request.hostname = hostname

      // Handle Telegram bot routes
      const telegramRoutes = {
        "/active": async () => {
          const webhookUrl = `https://${hostname}/webhook`
          const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: webhookUrl }),
          })
          return new Response(response.ok ? "Webhook set successfully" : "Failed to set webhook", {
            status: response.ok ? 200 : 500,
          })
        },
        "/delete": async () => {
          const response = await fetch(`${TELEGRAM_API_URL}/deleteWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
          return new Response(response.ok ? "Webhook deleted successfully" : "Failed to delete webhook", {
            status: response.ok ? 200 : 500,
          })
        },
        "/info": async () => {
          const response = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`)
          if (response.ok) {
            const data = await response.json()
            return new Response(JSON.stringify(data), { status: 200 })
          }
          return new Response("Failed to retrieve webhook info", { status: 500 })
        },
        "/webhook": async () => {
          if (request.method === "POST") {
            return await handleTelegramWebhook(request, hostname)
          }
          return new Response("Method not allowed", { status: 405 })
        },
      }

      if (telegramRoutes[url.pathname]) {
        return await telegramRoutes[url.pathname]()
      }

      // Handle WebSocket connections
      if (upgradeHeader === "websocket") {
        if (!url.pathname.startsWith(`/${CONFIG.PATH_INFO}/`)) {
          console.log(`Blocked request (Invalid Path): ${url.pathname}`)
          return new Response(null, { status: 403 })
        }

        const cleanPath = url.pathname.replace(`/${CONFIG.PATH_INFO}/`, "")
        const proxyIP = await getProxyIP(cleanPath, env)

        if (!proxyIP) {
          return new Response(null, { status: 403 })
        }

        return await websocketHandler(request, proxyIP)
      }

      // Handle subscription routes
      const subscriptionRoutes = {
        "/sub/clash": () => generateClashSub(url.searchParams, hostname),
        "/sub/v2rayng": () => generateV2rayngSub(url.searchParams, hostname),
        "/sub/v2ray": () => generateV2raySub(url.searchParams, hostname),
      }

      if (subscriptionRoutes[url.pathname]) {
        const configs = await subscriptionRoutes[url.pathname]()
        return new Response(configs)
      }

      // Default response with usage info
      const ping = await getLatency(url.href)
      const myIp =
        request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "IP tidak ditemukan"
      const ipInfo = await getIpInfo(myIp)

      return new Response(buildInfoText(hostname, ping, myIp, ipInfo), {
        status: 200,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
      })
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, { status: 500 })
    }
  },
}

// ==========================================
// UTILITY FUNCTIONS FOR MAIN WORKER
// ==========================================

async function getLatency(url) {
  const start = Date.now()
  await fetch(url)
  return Date.now() - start
}

async function getIpInfo(ip) {
  try {
    const response = await fetch(`https://ipinfo.io/${ip}/json`)
    return response.ok ? await response.json() : { error: "Unable to fetch IP information" }
  } catch (error) {
    return { error: "Unable to fetch IP information" }
  }
}

function buildInfoText(hostname, ping, myIp, ipInfo) {
  return `Hostname: ${hostname}
Path Info: ${CONFIG.PATH_INFO}
Ping: ${ping}ms
My IP: ${myIp}

IP Info: 
IP: ${ipInfo.ip || "N/A"}
City: ${ipInfo.city || "N/A"}
Region: ${ipInfo.region || "N/A"}
Country: ${ipInfo.country || "N/A"}
ISP: ${ipInfo.org || "N/A"}

====================
Commands untuk Pengguna :
====================
Basic Commands :
• /getrandomip
• /getrandom <Country>
• /listwildcard
• /wildcard add <domain>
• /history

VPN Generator Commands :
• /get vless
• /get vless ID
• /get trojan
• /get trojan US
• /get ss 
• /get ss NL

====================
Commands untuk Admin:
====================
Custom Domain Management (Admin Only):
• /customdomain list • List semua worker domains
• /customdomain add <domain> • Tambah worker domain
• /customdomain delete <domain> • Hapus worker domain
• /customdomain status • Cek status worker domains
• /customdomain init • Initialize worker subdomain

Contoh:
/customdomain add cache.netflix.com

Hasil: cache.netflix.com.${CONFIG.BASE_DOMAIN} (langsung aktif!)

====================
Cara Penggunaan Url Subs API:
====================
Contoh URL Lengkap:
• Clash Vless: https://${CONFIG.BASE_DOMAIN}/sub/clash?type=vless&bug=bug.com&tls=true&wildcard=true&limit=10&country=sg
• V2Ray Trojan: https://${CONFIG.BASE_DOMAIN}/sub/v2ray?type=trojan&bug=bug.com&tls=true&wildcard=false&limit=10&country=sg
• V2rayNG Shadowsocks: https://${CONFIG.BASE_DOMAIN}/sub/v2rayng?type=shadowsocks&bug=bug.com&tls=true&wildcard=false&limit=10&country=sg
====================`
}

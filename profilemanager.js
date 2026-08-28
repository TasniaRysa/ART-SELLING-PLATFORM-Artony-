require("dotenv").config()
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const cookieParser = require("cookie-parser");
const { doubleCsrf } = require("csrf-csrf");
const rateLimit = require("express-rate-limit");


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP per window
  message: { message: "Too many attempts, please try again later" }
});

const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
     cookie: {
        sameSite: "strict",
        secure: false
    }
}));


app.use((req, res, next) => {
  const blocked = ["/profiles.db", "/profilemanager.js", "/package.json", "/package-lock.json", "/.env", "/README.md"];
  if (blocked.includes(req.path)) {
    return res.status(403).end();
  }
  next();
});
app.use(express.static(__dirname));

//app.use(express.static(__dirname));


app.use(cookieParser());

const {
    generateCsrfToken,
    doubleCsrfProtection
} = doubleCsrf({
    getSecret: () => process.env.SESSION_SECRET,
    getSessionIdentifier: (req) => req.session.id,
    cookieName: "csrf-token",
    cookieOptions: { sameSite: "strict", secure: false },
    size: 64,
    getCsrfTokenFromRequest: (req) =>
        req.headers["x-csrf-token"] || req.body["x-csrf-token"]
});


const db=new Database("profiles.db");

db.prepare(`
    CREATE TABLE IF NOT EXISTS login (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )
`).run();

try {
    db.exec(`ALTER TABLE login ADD COLUMN skipform INTEGER DEFAULT 0`);
} catch (e) {
   console.log("Column 'skipform' already exists in 'login' table.");
}


db.exec(
    `CREATE TABLE IF NOT EXISTS interests(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid INTEGER NOT NULL,
    postid INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userid, postid),
    FOREIGN KEY(userid) REFERENCES login(id),
    FOREIGN KEY(postid) REFERENCES posts(id))`
);




db.exec(
    `CREATE TABLE IF NOT EXISTS posts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid INTEGER,
    text TEXT,
    imgurl TEXT
    ,
    mediatype TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userid) REFERENCES login(id))`
);


try {
    db.exec(`ALTER TABLE posts ADD COLUMN postcriteria TEXT DEFAULT NULL`);
} catch (e) {
  
}

try {
    db.exec(`ALTER TABLE posts ADD COLUMN vibe TEXT DEFAULT NULL`);
} catch (e) {
  // console.log("Column 'skipform' already exists in 'login' table.");
}

try {
    db.exec(`ALTER TABLE posts ADD COLUMN artmedium TEXT DEFAULT NULL`);
} catch (e) {
  // console.log("Column 'skipform' already exists in 'login' table.");
}

try {
    db.exec(`ALTER TABLE posts ADD COLUMN sellerlocation TEXT DEFAULT NULL`);
} catch (e) {
  // console.log("Column 'skipform' already exists in 'login' table.");
}

try {
    db.exec(`ALTER TABLE posts ADD COLUMN keywords TEXT DEFAULT NULL`);
} catch (e) {
  
}

try {
    db.exec(`ALTER TABLE posts ADD COLUMN price TEXT DEFAULT NULL`);
} catch (e) {
  // column already exists
}


db.exec(
    `CREATE TABLE IF NOT EXISTS profileinfo(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid INTEGER NOT NULL UNIQUE,
   username TEXT  NOT NULL,
   bio TEXT,
   workinfo TEXT,
   preferences TEXT,

   links TEXT,
   dp TEXT,
   FOREIGN KEY(userid) REFERENCES login(id)
)
   `
);
//db.exec(`DROP TABLE IF EXISTS profileinfo`);

db.exec(
    `CREATE TABLE IF NOT EXISTS cartinfo(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
   postid INTEGER NOT NULL,
   userid INTEGER NOT NULL,
   timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
   UNIQUE(userid, postid),
   FOREIGN KEY(postid) REFERENCES posts(id),
   FOREIGN KEY(userid) REFERENCES login(id)
)
   `
);
//db.exec(`DROP TABLE IF EXISTS cartinfo`);

if(!fs.existsSync("uploads"))
{fs.mkdirSync("uploads",{recursive:true});}
const storage=multer.diskStorage({
    destination:function(req,file,cb){
        cb(null,"uploads/");
    },
    filename:function(req,file,cb){
        cb(null,Date.now()+file.originalname);
    }
})

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, 
    fileFilter: function (req, file, cb) {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Unsupported file type"));
        }
    }
});
app.post("/upload",doubleCsrfProtection,upload.single("dp"),(req,res)=>{
    res.json(
        {imgurl:"/uploads/"+req.file.filename}
    )
    db.prepare("UPDATE profileinfo SET dp=? WHERE userid=?").run("/uploads/"+req.file.filename,req.session.userId);
})

app.post("/logout", doubleCsrfProtection, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: "Could not log out" });
        }
        res.clearCookie("connect.sid"); // default express-session cookie name
        res.redirect("index.html");
    });
});

app.get("/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
});
app.get("/cartitems", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "not logged in" });
    }
    const items = db.prepare(`
        SELECT cartinfo.postid, posts.text, posts.imgurl, posts.mediatype, posts.price
        FROM cartinfo
        JOIN posts ON cartinfo.postid = posts.id
        WHERE cartinfo.userid = ?
        ORDER BY cartinfo.timestamp DESC
    `).all(req.session.userId);

    res.json(items);
});

app.post("/removefromcart",doubleCsrfProtection, (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "not logged in" });
    }
    const { postid } = req.body;
    if (!postid) {
        return res.status(400).json({ message: "postid is required" });
    }
    db.prepare("DELETE FROM cartinfo WHERE userid = ? AND postid = ?")
        .run(req.session.userId, postid);
    res.json({ removed: true });
});
app.post("/contentpost",doubleCsrfProtection, upload.single("media"), (req, res) => {
    const text = req.body.text || null;
    const postcriteria = req.body.postcriteria || null;
    const vibe = req.body.vibe || null;
    const artmedium = req.body.artmedium || null;
    const sellerlocation = req.body.sellerlocation || null;
    const keywords = req.body.keywords || null;
    const price = req.body.price || null;
    const file = req.file || null;

    if (!text && !file) {
        return res.status(400).json({ error: "Text or file is required" });
    }

    const mediaurl = file ? "/uploads/" + file.filename : null;
    const mediatype = file ? file.mimetype.split("/")[0] : null;

    const insert = db.prepare(
        "INSERT INTO posts(userid, text, imgurl, mediatype, postcriteria, vibe, artmedium, sellerlocation, keywords, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insert.run(req.session.userId, text, mediaurl, mediatype, postcriteria, vibe, artmedium, sellerlocation, keywords, price);

    res.json({ message: "Post created successfully" });
});

app.post("/addtocart",doubleCsrfProtection, (req, res) => {

    if (!req.session.userId) {
        return res.status(401).json({ message: "not logged in" });
    }
    const { postid } = req.body;
    if (!postid) {
        return res.status(400).json({ message: "postid is required" });
    }

    console.log("Attempting insert with userid:", req.session.userId, "postid:", postid);
    db.prepare("INSERT INTO cartinfo(userid, postid) VALUES (?,?)")
            .run(req.session.userId, postid);
        return res.json({ interested: true });
})


app.post("/interest",doubleCsrfProtection, (req, res) => {
      if (!req.session.userId) {
        return res.status(401).json({ message: "not logged in" });
    }
    const { postid } = req.body;
    if (!postid) {
        return res.status(400).json({ message: "postid is required" });
    }
    db.prepare("INSERT INTO interests(userid, postid) VALUES (?,?)")
            .run(req.session.userId, postid);
        return res.json({ interested: true });
})
app.get("/skipform", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "not logged in" });
    }
    db.prepare("UPDATE login SET skipform = 1 WHERE id = ?").run(req.session.userId);
    res.redirect("/feed.html");
});

app.get("/showpost",(req,res)=>{
    const targetId = req.query.userid || req.session.userId;
    if (!targetId) {
        return res.status(401).json({ message: "not logged in" });
    }
    const posts = db.prepare("SELECT * FROM posts WHERE userid=? ORDER BY timestamp DESC ").all(targetId);
    res.json(posts);
})





app.get("/post", async (req, res) => {
    const userId = req.session.userId;

    const posts = await db.prepare(`SELECT posts.*, login.username, profileinfo.dp FROM posts
    JOIN login ON posts.userid = login.id
    LEFT JOIN profileinfo ON posts.userid = profileinfo.userid`).all();
    if (!userId) {
        // not logged in, just return by recency
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return res.json(posts);
    }

    // build user's interest history -> attribute frequency map
    const history = db.prepare(`SELECT posts.artmedium, posts.vibe, posts.keywords, posts.sellerlocation
        FROM interests JOIN posts ON interests.postid = posts.id
        WHERE interests.userid = ?`).all(userId);

    const weight = {};
    function bump(field, value) {
        if (!value) return;
        const key = field + ":" + value;
        weight[key] = (weight[key] || 0) + 1;
    }
    history.forEach(h => {
        bump("artmedium", h.artmedium);
        bump("vibe", h.vibe);
        bump("keywords", h.keywords);
        bump("sellerlocation", h.sellerlocation);
    });

    const now = Date.now();

    posts.forEach(p => {
        const ageHours = (now - new Date(p.timestamp).getTime()) / (1000 * 60 * 60);
        const recencyScore = Math.max(0, 100 - ageHours); // fresher = higher, decays over ~100 hrs

        let matchScore = 0;
        matchScore += weight["artmedium:" + p.artmedium] || 0;
        matchScore += weight["vibe:" + p.vibe] || 0;
        matchScore += weight["keywords:" + p.keywords] || 0;
        matchScore += weight["sellerlocation:" + p.sellerlocation] || 0;

        p.score = recencyScore + (matchScore * 10); // matches weighted heavier than recency
    });

    posts.sort((a, b) => b.score - a.score);

    res.json(posts);
});

app.post("/submit",doubleCsrfProtection, authLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res
            .status(400)
            .json({ message: "username and password are required" });
    }

    try {
        // hash password
        const cryptpw = await bcrypt.hash(password, 10);

        // prepare statement
        const stmt = db.prepare(
            "INSERT INTO login(username, password) VALUES (?, ?)"
        );

        // execute
        stmt.run(username, cryptpw);

        return res.redirect("/login.html");

    } catch (err) {
        console.log(err);

        // username already exists
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({
                message: "Username already exists"
            });
        }

        return res
            .status(500)
            .json({ message: "internal server error" });
    }
});



app.get("/profileget", (req, res) => {
    if(!req.query.userid) 
    {
        return res.status(401).json({ message: "problem accessing this profile" });

    }
    const profile=db.prepare("SELECT * FROM profileinfo WHERE userid = ?").get(req.query.userid);
    if(!profile) return res.json({message:"profile not found"});
    res.json(profile);
})

app.get("/profile", (req, res) => {
    if(!req.session.userId)
    {
        return res.status(401).json({ message: "not logged in" });

    }
    const profile=db.prepare("SELECT * FROM profileinfo WHERE userid = ?").get(req.session.userId);
    if(!profile) return res.json({message:"profile not found"});
    res.json(profile);
})

// ================= LOGIN =================
app.post("/login",doubleCsrfProtection,authLimiter, async (req, res) => {

    const { username, password } = req.body;

    if (!username || !password) {
        return res
            .status(400)
            .json({ message: "username and password are required" });
    }

    try {

        // get user
        const stmt = db.prepare(
            "SELECT * FROM login WHERE username = ?"
        );

        const user = stmt.get(username);

        if (!user) {
            return res.status(404).send("No such user exists");
        }

        // compare password
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(400).send("Incorrect password");
        }
        req.session.userId = user.id;

        // optional JWT token
        /*
        const token = jwt.sign(
            { id: user.id, username: user.username },
            "secretkey",
            { expiresIn: "1h" }
        );
        */

        const profile = db.prepare("SELECT id FROM profileinfo WHERE userid = ?").get(user.id);
const userRow = db.prepare("SELECT skipform FROM login WHERE id = ?").get(user.id);

if (profile || userRow.skipform === 1) {
    return res.redirect("/feed.html");
}
return res.redirect("/form.html");
    } catch (err) {
        console.log(err);

        return res
            .status(500)
            .json({ message: "internal server error" });
    }
});




app.post("/profileinfo",doubleCsrfProtection, (req, res) => {
    let { bio, workinfo, preferences, links, dp, username } = req.body;

    const toArray = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    workinfo = toArray(workinfo);
    preferences = toArray(preferences);
    links = toArray(links);

    const usr = db.prepare("SELECT username FROM login WHERE id=?").get(req.session.userId);
    db.prepare("INSERT INTO profileinfo(userid,username,bio,workinfo,preferences,links,dp) VALUES (?,?,?,?,?,?,?)")
        .run(req.session.userId, usr.username, bio, JSON.stringify(workinfo), JSON.stringify(preferences), JSON.stringify(links), dp);

    res.redirect("/profile.html");
})


app.use((err, req, res, next) => {
    if (err) {
        return res.status(400).json({ message: err.message });
    }
    next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`server started on port ${PORT} at http://localhost:${PORT}/index.html`)
})
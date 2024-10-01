const { Pool } = require('pg');
const express = require("express");
const app = express();
const ejs = require("ejs")
const Session = require("express-session");
const filestore = require("session-file-store")(Session)
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cookieparser = require("cookie-parser")
const upload = require("./utils/multerform")
let posts;
const port = process.env.PORT || 3000
require("dotenv").config()
let pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
})

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(Session({
    store: new filestore(),
    secret: process.env.SESSION_SECRET_KEY,
    saveUninitialized: false,
    resave: false,
    cookie: { secure: false }
}))
app.use(cookieparser())
app.set("view engine", "ejs")

const isAuthenticated = (req, res, next) => {
    if (req.session.user && req.session.user.username) {
        console.log(req.session.user)
        const token = req.cookies["Token"];
        if (token) {
            let decoded = jwt.verify(token, "kkmodi")
            try {
                if (decoded.username === req.session.user.username && decoded.email === req.session.user.email) {
                    req.session.user = decoded
                    console.log(decoded)
                    console.log(req.session.user)
                }
            } catch (err) {
                return res.status(401).send("Unauthorized: Session does not match token.");
            }
        }
        next()
    } else {
        res.redirect("/login")
    }
}

// function run() {
//     let query = `
//     SELECT posts.*, users.pic 
//     FROM posts 
//     JOIN users ON posts.user_id = users.user_id 
//     ORDER BY posts.post_id DESC
// `;
//     pool.query(query, (err, result) => {
//         if (err) throw err;
//         posts = result.rows
//     })
// }
// run()

app.get("/", isAuthenticated, (req, res) => {
    let query = `
    SELECT posts.*, users.pic 
    FROM posts 
    JOIN users ON posts.user_id = users.user_id 
    ORDER BY posts.post_id DESC
`;

    console.log("resss::  ", req.session.user)
    pool.query(query, (err, result) => {
        if (err) throw err;

        let posts = result.rows;
        console.log("posts : ", posts);

        // Render the 'index' page with posts, including user pictures
        res.render("index", { user: req.session.user, posts: posts });
    });
});

app.get("/pp", (req, res) => {
    let sal = `CREATE TABLE users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(150) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        pic TEXT,
        posts_id INTEGER[] 
    ); 
   `
    let sal2 = `CREATE TABLE posts (
    post_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    username VARCHAR(255) NOT NULL,     
    likes INTEGER[]   
  );`
    pool.query(sal2, (err, res) => {
        if (err) throw err;
        console.log("post");
    })
})

app.get("/register", (req, res) => {
    res.render("register", {
        taken: false,
        username: '',
        email: ''
    });
})

app.post("/register", async (req, res) => {
    const { username, password, email } = req.body;
    const salt = crypto.randomBytes(64).toString("hex");
    const final_password = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");

    const query = `
        WITH existing_user AS (
            SELECT * FROM users WHERE username = $1 OR email = $2
        )
        INSERT INTO users (username, password, email, salt)
        SELECT $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT * FROM existing_user)
        RETURNING *;
    `;

    try {
        const result = await pool.query(query, [username, email, username, final_password, email, salt]);

        if (result.rowCount === 0) {
            return res.render('register', {
                taken: true,
                username,
                email
            });
        }
        res.redirect("/login");
    } catch (err) {
        console.error("Error executing query:", err);
        return res.status(500).send("Internal Server Error");
    }
});


app.get("/login", (req, res) => {
    res.render("login", {
        incorrect: false
    })
})

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const query = "SELECT * FROM users WHERE username = $1";
    console.log(req.body);
    pool.query(query, [username], (err, result) => {
        if (err) throw err;
        if (result.rows.length > 0) {
            let user = result.rows[0];
            const hashedPassword = crypto.pbkdf2Sync(password, user.salt, 10000, 64, 'sha512').toString('hex');

            if (user.password === hashedPassword) {
                const payload = {
                    id: user.user_id,
                    username: user.username,
                    email: user.email,
                    pic: user.pic,
                    followers: user.followers
                }
                req.session.user = payload
                const token = jwt.sign(payload, "kkmodi")
                res.cookie("Token", token)
                res.redirect("/");
            } else {
                res.render("login", {
                    incorrect: true
                })
            }
        } else {
            res.render("login", {
                incorrect: true
            })
        }
    })
})

app.get("/profilepic", (req, res) => {
    console.log(req.session.user.pic);
    res.render("profilepic")
})

app.post("/profilepic", upload.single("avatar"), (req, res) => {
    const filename = req.file.filename;
    const userId = req.session.user.id
    const query = `UPDATE users SET pic = $1 WHERE user_id = $2 RETURNING *`;

    pool.query(query, [filename, userId], (err, result) => {
        if (err) {
            console.error("Error updating picture:", err);
            return res.status(500).send("Error updating profile picture.");
        }

        if (result.rowCount > 0) {
            req.session.user.pic = result.rows[0].pic;
        } else {
            console.log("No user found with that user_id. No row updated.");
        }

        res.render("profile", { user: req.session.user, posts: posts });
    });
})



app.get("/profile", isAuthenticated, (req, res) => {
    let user_id = req.session.user.id; 
    let query = `SELECT * FROM posts WHERE user_id = $1 ORDER BY post_id DESC`;

    pool.query(query, [user_id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Internal Server Error");
        }

        // Fetch user posts from the result
        const posts = result.rows;
        // Render the profile EJS template and pass the posts data
        res.render("profile", { user: req.session.user, posts: posts });
    });
})

app.get("/profile/:userid", isAuthenticated, (req, res) => {
    const userid = req.params.userid; 
    const reqUserID = req.session.user.id; 
    
    const query = `SELECT * FROM users WHERE user_id = $1`;
    pool.query(query, [userid], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Internal Server Error");
        }

        if (result.rows.length === 0) {
            return res.status(404).send("User not found"); 
        }

        const user = result.rows[0];

        // Query to fetch posts for the user
        const postsQuery = `SELECT * FROM posts WHERE user_id = $1 ORDER BY post_id DESC`;
        pool.query(postsQuery, [user.user_id], (err, postsResult) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Internal Server Error");
            }

            const posts = postsResult.rows;
            console.log("USETE:  ", user)
            
            const isfollow = user.folowers ? user.folowers.includes(reqUserID) ? true : false : false ;
            res.render("profile2", { user: user, posts: posts, uID:req.session.user.id, isfollow });
        });
    });
});

app.get("/createpost", (req, res) => {
    // console.log(req.session.user)
    res.render("createpost")
})

app.get("/k", (req, res) => {
    let query = `ALTER TABLE posts
    ADD COLUMN comments INT4 NOT NULL DEFAULT 0`
    pool.query(query, (err, res) => {
        console.log("result : ", res)
    })
})

app.post("/createpost", async (req, res) => {
    const { content } = req.body;
    const user_id = req.session.user.id;
    const user_name = req.session.user.username;

    const query = `
        WITH new_post AS (
            INSERT INTO posts (user_id, content, username) 
            VALUES ($1, $2, $3) 
            RETURNING post_id
        )
        UPDATE users 
        SET posts_id = array_append(posts_id, (SELECT post_id FROM new_post)) 
        WHERE user_id = $4;
    `;

    try {
        await pool.query(query, [user_id, content, user_name, user_id]);
        console.log("Post created and user's posts_id array updated");
        res.redirect("/profile"); 
    } catch (err) {
        throw err; 
    }
});

app.get("/likes/:id", async (req, res) => {
    const { id: post_id } = req.params;
    const user_id = req.session.user.id;

    try {
        const query = `
            UPDATE posts
            SET likes = CASE
                WHEN $1 = ANY(likes) THEN array_remove(likes, $1)
                ELSE array_append(likes, $1)
            END
            WHERE post_id = $2
            RETURNING likes;
        `;

        const result = await pool.query(query, [user_id, post_id]);

        res.json({ likes: result.rows[0].likes });
    } catch (err) {
        throw err;
    }
});

app.get("/check-like/:id", async (req, res) => {
    const { id: post_id } = req.params;
    const user_id = req.session.user.id; 
    const checkQuery = `
        SELECT likes FROM posts WHERE post_id = $1 AND $2 = ANY (likes);
    `;

    const result = await pool.query(checkQuery, [post_id, user_id]);

    if (result.rowCount > 0) {
        // User has liked the post
        res.json({ liked: true });
    } else {
        // User has not liked the post
        res.json({ liked: false });
    }
});

app.get("/follow/:id", (req, res) => {
    const { id } = req.params;
    const user_id = req.session.user.id;

    const checkFollowQuery = `SELECT folowers FROM users WHERE user_id = $1`;

    pool.query(checkFollowQuery, [id], (err, result) => {
        if (err) throw err;

        const followers = (result.rows.length > 0 && result.rows[0].folowers) ? result.rows[0].folowers : [];
        console.log("FOLLOWERS:: ", followers)
        let query;

        if (followers.includes(user_id)) {
            query = `UPDATE users SET folowers = array_remove(folowers, $1) WHERE user_id = $2 RETURNING folowers`;
            console.log("removed")
        } else {
            query = `UPDATE users SET folowers = array_append(folowers, $1) WHERE user_id = $2 RETURNING folowers`;
            console.log("added")
        }

        pool.query(query, [user_id, id], (err, result) => {
            if (err) throw err;
            res.json({ followers: result.rows[0].folowers });
        });
    });
});

app.get("/post/:id", async (req,res)=>{
    let query = `
    SELECT posts.*, users.pic
    FROM posts
    JOIN users ON posts.user_id = users.user_id
    WHERE posts.post_id = $1
    ORDER BY posts.post_id DESC`
;
    let { id:postId } = req.params

    let result = await pool.query(query, [postId])
    console.log("result.rows[0]: ", result.rows[0]);
      
    let q2 = `SELECT posts.*, users.*, comment.*
        FROM comment
        JOIN posts ON comment.postid = posts.post_id 
        JOIN users ON comment.userid = users.user_id 
        WHERE comment.postid = $1 
        ORDER BY comment.id DESC`

    let result2 = await pool.query(q2, [postId])
    console.log("result2: ", result2.rows);
    res.render("comments", {post: result.rows[0], user: req.session.user, comments: result2.rows})
        
    
})

app.get("/comment/:id",(req,res)=>{
    res.render("createcomment",{id: req.params.id})
})

app.post("/comment/:id/:pId",(req,res)=>{
    let { id:postId, pId } = req.params;
    let {content} = req.body
    let user = req.session.user;
    let query = `INSERT INTO comment (postid, content, userid) VALUES ($1, $2, $3)`
    pool.query(query, [postId, content, user.id], (err,result)=>{
        if(err) throw err;
        let query2 = `UPDATE posts
        SET comments = (SELECT COUNT(*) FROM comment WHERE postid = posts.post_id)`;
        pool.query(query2, (err,result2)=>{
            if(err) throw err
            console.log(result);
            res.redirect(`/post/${pId}`)
        })
    })
})

app.get("/del/com/:id/:pId",(req,res)=>{
    let { id, pId } = req.params;
    let query = `DELETE FROM comment WHERE id = $1`;

    pool.query(query, [id], (err,result)=>{
        if(err) throw err;
        let query2 = `UPDATE posts
        SET comments = (SELECT COUNT(*) FROM comment WHERE postid = posts.post_id)`
        pool.query(query2, (err,result2)=>{
            if(err) throw err;
            res.redirect(`/post/${pId}`)
        })
    })
})

app.get("/delete/:id", async (req, res) => {
    let { id } = req.params;

    const query = `
    WITH removed AS (
        UPDATE users SET posts_id = array_remove(posts_id, $1) 
        WHERE $1 = ANY(posts_id)
        RETURNING *
    )
    DELETE FROM posts WHERE post_id = $1
    `;

    try {
        await pool.query(query, [id]);
        console.log("Post deleted and user updated.");
        res.redirect("/profile");
    } catch (err) {
        console.error("Error deleting record:", err);
        return res.status(500).send("Error deleting record");
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send("Could not log out.");
        }
        res.clearCookie("connect.sid"); 
        res.clearCookie("Token"); 
        res.redirect("/login"); 
    });
});

app.listen(port)


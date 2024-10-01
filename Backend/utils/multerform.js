const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'G:/Workspace/Tailwind css/Post/Backend/public/images')
    },
    filename: function (req, file, cb) {
        crypto.randomBytes(12, (err,name)=>{
            cb(null, name.toString("hex")+path.extname(file.originalname))
        })
    }
})

const upload = multer({ storage: storage })

module.exports = upload;
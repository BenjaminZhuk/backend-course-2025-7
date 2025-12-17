const {program} = require ("commander");
const http = require("http");
const fs =require("fs");
const path = require("path");
const fsp= fs.promises;
const superagent = require("superagent");
const express = require('express')
const multer = require('multer');
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");

const swaggerDocument = yaml.load(path.join(__dirname,"inventory.yaml"));

program 

.requiredOption("-h, --host <host>", "Введіть адресу хоста")
.requiredOption("-p, --port <port>", "Введіть порт сервера")
.requiredOption("-c, --cache <path>", "Введіть шлях до директорії");

program.configureOutput({
outputError: (str, write) => {
 }
});

program.exitOverride();


try{
program.parse();

}
catch(err){
if (err.code === 'commander.missingMandatoryOptionValue') {
    console.error("Please write required argument")
  }
 else console.error(err.message)
 process.exit(1);
}
const options= program.opts();
const cachePath = path.resolve(options.cache);
 if (!fs.existsSync(cachePath)) {
  console.error("Директорія кешу не існує");
  fs.mkdirSync(cachePath, { recursive: true });
  console.log("Директорію створено");
 }
 else {
    console.log("Директорія кешу вже існує:", cachePath);
 };

 const host = options.host;
 const port = options.port;
 const app = express();
 app.use(express.json());
 app.use(express.urlencoded({ extended: true }));

 const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, cachePath);
    },
    filename: function (req, file, cb) {

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
let inventory = [];
const upload = multer({ storage: storage });
app.get('/',(req,res)=>{
    res.send('Entry endpoints');
});
app.get('/RegisterForm.html', (req,res)=>{
    res.sendFile(path.join(__dirname,'RegisterForm.html'));
});
app.get('/SearchForm.html', (req,res)=>{
    res.sendFile(path.join(__dirname,'SearchForm.html'));
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.post('/register', upload.single('photo'), (req,res)=>{
    const {inventory_name,description}=req.body;
    if (!inventory_name) {
        return res.status(400).send('Bad Request: inventory_name is required');
    }
    const newItem = {
        id: Date.now().toString(),
        name: inventory_name,
        description: description || '',
        photo: req.file ? req.file.filename : null
    };
    inventory.push(newItem);
    res.status(201).send('Created');
});

app.get('/inventory', (req,res)=>{

const result = inventory.map(item => ({
    ...item,
    photoUrl: item.photo ? `http://localhost:${port}/inventory/${item.id}/photo` : null
}));
res.status(200).json(result);
});

app.get('/inventory/:id', (req,res)=>{
const item = inventory.find(i => i.id === req.params.id);
 if (!item) return res.status(404).send('Not Found');
 const result = {
    ...item,
    photoUrl: item.photo ? `http://localhost:${port}/inventory/${item.id}/photo` : null
 };
 res.status(200).json(result);
});
app.put('/inventory/:id', (req,res)=>{
    const item = inventory.find(i => i.id === req.params.id);
    if (!item) return res.status(404).send('Not Found');
    const { name, description}=req.body;
    if (name) item.name = name;
    if (description) item.description = description;
    res.status(200).send('Updated');
});
app.get('/inventory/:id/photo', (req,res)=>{
    const item = inventory.find(i => i.id === req.params.id);
    if (!item || !item.photo) return res.status(404).send('Not found');
    const filePath = path.join(cachePath, item.photo);
    if (fs.existsSync(filePath)) {
        res.set('Content-Type', 'image/png');
        res.sendFile(filePath);
    }else {
        res.status(404).send('THERE IS NO PHOTO ON DISK');
    }
});
app.put('/inventory/:id/photo', upload.single('photo'),(req,res)=>{
    const item = inventory.find(i => i.id === req.params.id);
    if (!item) return res.status(404).send('Not found');
    if (!req.file) return res.status(400).send('No file uploaded');

    item.photo = req.file.filename;
    res.status(200).send('Photo updated');
});

app.delete('/inventory/:id', (req,res)=>{
const idx = inventory.findIndex(i => i.id === req.params.id);
if (idx === -1) return res.status(404).send('Not found');
const item = inventory[idx];
if (item.photo){
    const p = path.join(cachePath, item.photo);
        if (fs.existsSync(p)) fs.unlinkSync(p);
}
inventory.splice(idx, 1);
    res.status(200).send('Deleted');
});
app.post('/search',(req,res)=>{
    const { id, has_photo } = req.body;
    const item = inventory.find(i => i.id === id);
    if (!item) return res.status(404).send('Not Found');
    let responseItem = { ...item };
    if (has_photo) {
        const link = item.photo ? `http://localhost:${port}/inventory/${item.id}/photo` : 'No photo';
        responseItem.description = `${responseItem.description} (Photo link: ${link})`;
    }
    res.status(200).json(responseItem);
})
app.use((req,res)=>{
    res.status(404).send('Not found or Method not allo');
});
const server = http.createServer(app);
server.listen(port, host, () => {
    console.log(`Сервер успішно запущено на http://localhost:${port}`);
    
});








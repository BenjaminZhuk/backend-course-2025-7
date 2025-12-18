const { program } = require("commander");
const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require('express');
const multer = require('multer');
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");
require('dotenv').config();
const mysql = require("mysql2/promise");


let swaggerDocument;
try {
    swaggerDocument = yaml.load(path.join(__dirname, "inventory.yaml"));
} catch (e) {
    console.log("Swagger file not found or invalid");
}

program
    .option('-h, --host <host>')
    .option('-p, --port <port>')
    .option('-c, --cache <path>');

program.parse(process.argv);
const options = program.opts();

const host = options.host || process.env.HOST || '0.0.0.0';
const port = options.port || process.env.PORT || 3000;
const cache = options.cache || process.env.CACHE_DIR || './cache';

if (!host || !port || !cache) {
    console.error("Please provide arguments or set .env variables");
    process.exit(1);
}


const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


if (!fs.existsSync(cache)){
    fs.mkdirSync(cache, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, cache);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });



app.get('/', (req, res) => {
    res.send('Entry endpoints');
});

app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

if (swaggerDocument) {
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}


app.post('/register', upload.single('photo'), async (req, res) => {
    try {
        const { inventory_name, description } = req.body;
        
        if (!inventory_name) {
            return res.status(400).send('Bad Request: inventory_name is required');
        }

        const photoFilename = req.file ? req.file.filename : null;

        const [result] = await pool.execute(
            'INSERT INTO items (name, description, photo) VALUES (?, ?, ?)',
            [inventory_name, description || '', photoFilename]
        );

        res.status(201).send(`Created with ID: ${result.insertId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});


app.get('/inventory', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM items');
        
        const result = rows.map(item => ({
            ...item,
            photoUrl: item.photo ? `http://${host}:${port}/inventory/${item.id}/photo` : null
        }));
        
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

app.get('/inventory/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM items WHERE id = ?', [req.params.id]);
        
        if (rows.length === 0) return res.status(404).send('Not Found');

        const item = rows[0];
        const result = {
            ...item,
            photoUrl: item.photo ? `http://${host}:${port}/inventory/${item.id}/photo` : null
        };
        
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

app.put('/inventory/:id', async (req, res) => {
    try {
        const { name, description } = req.body;
        
        
        const [check] = await pool.execute('SELECT id FROM items WHERE id = ?', [req.params.id]);
        if (check.length === 0) return res.status(404).send('Not Found');

      
        await pool.execute(
            'UPDATE items SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
            [name || null, description || null, req.params.id]
        );

        res.status(200).send('Updated');
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});


app.get('/inventory/:id/photo', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT photo FROM items WHERE id = ?', [req.params.id]);
        
        if (rows.length === 0 || !rows[0].photo) return res.status(404).send('Not found or no photo');
        
        const filePath = path.resolve(__dirname, cache, rows[0].photo);
        
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('File missing on disk');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded');

        const [check] = await pool.execute('SELECT id FROM items WHERE id = ?', [req.params.id]);
        if (check.length === 0) return res.status(404).send('Not Found');

        await pool.execute('UPDATE items SET photo = ? WHERE id = ?', [req.file.filename, req.params.id]);
        
        res.status(200).send('Photo updated');
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});


app.delete('/inventory/:id', async (req, res) => {
    try {
        
        const [rows] = await pool.execute('SELECT photo FROM items WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).send('Not found');

        const item = rows[0];

        
        await pool.execute('DELETE FROM items WHERE id = ?', [req.params.id]);

        
        if (item.photo) {
            const p = path.join(cache, item.photo);
            if (fs.existsSync(p)) {
                fs.unlink(p, (err) => {
                    if (err) console.error("Error deleting file:", err);
                });
            }
        }

        res.status(200).send('Deleted');
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});


app.post('/search', async (req, res) => {
    try {
        const { id, has_photo } = req.body;
        
        const [rows] = await pool.execute('SELECT * FROM items WHERE id = ?', [id]);
        
        if (rows.length === 0) return res.status(404).send('Not Found');
        
        let responseItem = { ...rows[0] };
        
        if (has_photo) {
            const link = responseItem.photo ? `http://${host}:${port}/inventory/${responseItem.id}/photo` : 'No photo';
            responseItem.description = `${responseItem.description} (Photo link: ${link})`;
        }
        
        res.status(200).json(responseItem);
    } catch (err) {
        console.error(err);
        res.status(500).send('Database Error');
    }
});

app.use((req, res) => {
    res.status(404).send('Not found or Method not allowed');
});


async function initBD(){
   try {
        const connection = await pool.getConnection();
        console.log("Підключено до БД");
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                photo VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

   } catch (err){
     console.error("Помилка", err.message)
   }

}



const server = http.createServer(app);
initBD();
server.listen(port, host, async () => {
    console.log(`Сервер успішно запущено у http://${host}:${port}`);
    
    
    try {
        const connection = await pool.getConnection();
        console.log("Успішне підключення до mysql");
        connection.release();
    } catch (err) {
        console.error("Помилка підключення до MySQL:", err.message);
    }
});
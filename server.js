const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
// Yahan humne data limit badha di hai HD banners ke liye
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){ fs.mkdirSync(uploadDir); }
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({ storage: storage });

const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/shrimaruti";

mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch((err) => console.log("Database Connection Error: ", err));
// ==========================================
// --- MONGOOSE SCHEMAS (STOCK FIXED) ---
// ==========================================
const productSchema = new mongoose.Schema({
    title: String, 
    price: Number, 
    image: String, 
    desc: String, 
    category: String, 
    discount: String,
    stock: { type: Number, default: 0 }, // 🎯 SOLVED: Stock field integrated for Sold Out checking
    reviews: [{ user: String, text: String, rating: Number }]
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
    orderId: String, items: Array, total: Number, status: String, date: String, addressDetails: Object
});
const Order = mongoose.model('Order', orderSchema);


// ==========================================
// --- CORE ADMIN ROUTE ---
// ==========================================
app.post('/api/admin/verify', (req, res) => {
    if (req.body.passcode === "Admin2026") res.json({ success: true });
    else res.status(401).json({ success: false, message: "Invalid Passcode" });
});

// ==========================================
// --- PRODUCTS ENGINE ROUTES ---
// ==========================================
app.get('/api/products', async (req, res) => { res.json(await Product.find()); });

// API: Add products with stock configuration
app.post('/api/products', upload.single('image'), async (req, res) => {
    const newProduct = new Product({
        title: req.body.title, 
        price: Number(req.body.price),
        image: req.file ? `http://localhost:5000/uploads/${req.file.filename}` : '',
        desc: req.body.desc || "Premium quality product.",
        category: req.body.category || 'Cosmetics',
        discount: req.body.discount || '10% OFF',
        stock: req.body.stock !== undefined ? Number(req.body.stock) : 10, // 🎯 SOLVED: Captures admin stock input
        reviews: [] 
    });
    await newProduct.save();
    res.status(201).json(newProduct);
});

// API: Edit/Update Product
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
    try {
        console.log("=====================================");
        console.log("🛠️ EDIT REQUEST RECEIVED FOR ID:", req.params.id);
        
        const updateData = {
            title: req.body.title, 
            price: Number(req.body.price),
            discount: req.body.discount,
            desc: req.body.desc,
            category: req.body.category,
            stock: Number(req.body.stock) // 🎯 SOLVED: Updates stock directly from edit modal form
        };
        
        if (req.file) {
            updateData.image = `http://localhost:5000/uploads/${req.file.filename}`;
        }
        
        const updated = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
        
        if(!updated) return res.status(404).json({ error: "Product not found" });
        
        res.json({ success: true, message: "Product Updated!", product: updated });
    } catch (err) {
        res.status(500).json({ error: "Failed to update", details: err.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

// ==========================================
// --- REVIEWS SYSTEM ---
// ==========================================
app.post('/api/products/:id/reviews', async (req, res) => {
    const product = await Product.findById(req.params.id);
    if(product) {
        product.reviews.push({ user: req.body.user, text: req.body.text, rating: req.body.rating });
        await product.save();
        res.json({ success: true, product });
    } else res.status(404).json({ message: "Product not found" });
});

// ==========================================
// --- ORDER FLOW & TRACKING ENGINE ---
// ==========================================
app.get('/api/admin/orders', async (req, res) => { res.json(await Order.find()); });

app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order({
            orderId: 'SMF-' + Math.floor(Math.random() * 1000000), 
            items: req.body.items, 
            total: req.body.totalAmount, 
            status: 'Processing',
            date: new Date().toLocaleDateString(), 
            addressDetails: req.body.address
        });

        // 🎯 OPTIONAL AUTOMATION: Order hone par core database stock deduct karne ke liye
        for (const item of req.body.items) {
            await Product.findByIdAndUpdate(item._id, { $inc: { stock: -1 } });
        }

        await newOrder.save();
        res.status(201).json(newOrder);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Find single order (Synced with Track UI)
app.get('/api/orders/:id', async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.id.trim() });
        if(!order) return res.status(404).json({ error: "Order not found" });
        res.json(order);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Customer Cancel Order Route
app.put('/api/orders/:id/cancel', async (req, res) => {
    try {
        const updated = await Order.findOneAndUpdate(
            { orderId: req.params.id.trim() },
            { status: "Cancelled", cancelReason: req.body.reason },
            { new: true }
        );
        if(!updated) return res.status(404).json({ error: "Order not found" });
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Admin Dropdown Status Update Route
app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const updated = await Order.findOneAndUpdate(
            { orderId: req.params.id.trim() },
            { status: req.body.status },
            { new: true }
        );
        if(!updated) return res.status(404).json({ error: "Order not found" });
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Admin Delete Order Route
app.delete('/api/orders/:id', async (req, res) => {
    try {
        const deletedOrder = await Order.findOneAndDelete({ orderId: req.params.id.trim() });
        if(!deletedOrder) return res.status(404).json({ error: "Order not found" });
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// --- DYNAMIC BANNER DATABASE (ADVANCED CANVA MODE) ---
// ==========================================
const bannerSchema = new mongoose.Schema({ 
    heading: String,
    image: String, // Naya: Image save karne ke liye
    textColor: String, // Naya: Text color
    bgColor: String // Naya: Background color
});
const Banner = mongoose.model('Banner', bannerSchema);

app.get('/api/banner', async (req, res) => {
    try {
        let banner = await Banner.findOne();
        if (!banner) {
            banner = new Banner({ heading: "Biggest Fashion Sale", textColor: "#ffffff", bgColor: "#ff3f6c" });
            await banner.save();
        }
        res.json(banner);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/banner', async (req, res) => {
    try {
        let banner = await Banner.findOne();
        if (!banner) banner = new Banner();
        
        // Agar admin ne text blank bhi choda hai toh wo blank save hona chahiye
        if (req.body.heading !== undefined) banner.heading = req.body.heading;
        if (req.body.textColor) banner.textColor = req.body.textColor;
        if (req.body.bgColor) banner.bgColor = req.body.bgColor;
        if (req.body.image !== undefined) banner.image = req.body.image; // Image base64 string
        
        await banner.save();
        res.json({ success: true, message: "Full Design Saved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.listen(5000, () => console.log(`🚀 Server running on port 5000`));
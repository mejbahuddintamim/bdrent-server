const express = require("express");
const { isWithinInterval, parseISO } = require("date-fns");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const SSLCommerzPayment = require("sslcommerz-lts");
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;
// SSLCommerz configuration
const store_id = process.env.SSL_STORE_ID;
const store_passwd = process.env.SSL_STORE_PASSWORD;
const is_live = false; //true for live, false for sandbox

// Middlewares
const whitelist = ["http://localhost:3000", "https://bdrent.vercel.app"];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// MongoDB connection
const uri = process.env.DB_URI;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// Decode JWT
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

// Send Mail
const sendMail = (emailData) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.NODEMAIL_EMAIL,
      pass: process.env.NODEMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: process.env.NODEMAIL_EMAIL,
    // "To" this user will receive the email
    to: emailData?.bookingData?.hostEmail,
    subject: emailData?.subject,
    html: `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
              font-family: Arial, sans-serif;
              background-color: #f7f7f7;
              margin: 0;
              padding: 20px;
          }
          h5 {
              color: #333;
          }
          p {
              color: #555;
              line-height: 1.8;
          }
          ul {
              list-style: none;
              padding: 0;
          }
          li {
              margin-bottom: 10px;
          }
          strong {
              font-weight: bold;
          }
          .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #fff;
              padding: 30px;
              border-radius: 5px;
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          }
          .logo {
              margin-bottom: 20px;
          }
          .logo img {
              max-width: 120px;
          }
          .footer {
              margin-top: 25px;
              text-align: center;
              color: #888;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <img src="https://i.ibb.co/Svd6zDd/logo.png" alt="Company Logo" />
          </div>
          <h5>New Booking Details:</h5>
          <ul>
            <li><strong>Booking ID:</strong> ${emailData?.bookingId}</li>
            <li><strong>Home Title:</strong> ${emailData?.bookingData?.home?.title}</li>
            <li><strong>Home Location:</strong> ${emailData?.bookingData?.home?.location}</li>
            <li><strong>User Name:</strong> ${emailData?.bookingData?.guestName}</li>
            <li><strong>User Email:</strong> ${emailData?.bookingData?.guestEmail}</li>
            <li><strong>Transaction ID:</strong> ${emailData?.bookingData?.transactionId}</li>
          </ul>
          <div class="footer">
          <p>All rights reserved to BD Rent</p>
          </div>
        </div>
      </body>
    </html>
    `,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};

async function run() {
  try {
    const homesCollection = client.db("bdrent").collection("homes");
    const usersCollection = client.db("bdrent").collection("users");
    const bookingsCollection = client.db("bdrent").collection("bookings");

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Save user email & generate JWT
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });
      res.send({ result, token });
    });

    // Upadate booking status
    app.put("/homebookingstatus", async (req, res) => {
      const { isBooked, id } = req.body;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: { isBooked },
      };
      const result = await homesCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // Nid image link upload
    app.put("/nidimage/:email", async (req, res) => {
      const email = req.params.email;
      const { nidImg } = req.body;
      const filter = { email: email };
      const options = { upsert: true };

      const result = await usersCollection.updateOne(
        filter,
        {
          $set: { nidImg },
        },
        options
      );
      res.send(result);
    });

    // Passport image link upload
    app.put("/passportimage/:email", async (req, res) => {
      const email = req.params.email;
      const { passportImg } = req.body;
      const filter = { email: email };
      const options = { upsert: true };

      const result = await usersCollection.updateOne(
        filter,
        {
          $set: { passportImg },
        },
        options
      );
      res.send(result);
    });

    // Get a single user by email
    app.get("/user/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user);
    });

    // Get a single user confirmation by email
    app.get("/confirmuser/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        return res.send(true);
      } else {
        return res.send(false);
      }
    });

    // Get all users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // Post a home
    app.post("/homes", verifyJWT, async (req, res) => {
      const homes = req.body;
      const result = await homesCollection.insertOne(homes);
      res.send(result);
    });

    // Get All Homes
    app.get("/homes", async (req, res) => {
      const query = { isBooked: { $ne: true } };
      const cursor = homesCollection.find(query);
      const homes = await cursor.toArray();
      res.send(homes);
    });

    // Get All Homes for host
    app.get("/homes/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = {
        "host.email": email,
      };
      const cursor = homesCollection.find(query);
      const homes = await cursor.toArray();
      res.send(homes);
    });

    // Get Single Home
    app.get("/home/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id), isBooked: { $ne: true } };
      const home = await homesCollection.findOne(query);
      res.send(home);
    });

    // Delete a home
    app.delete("/home/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await homesCollection.deleteOne(query);
      res.send(result);
    });

    // Update A Home
    app.put("/homes", verifyJWT, async (req, res) => {
      const home = req.body;
      const filter = {};
      const options = { upsert: true };
      const updateDoc = {
        $set: home,
      };
      const result = await homesCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // Save a booking
    app.post("/bookings", verifyJWT, async (req, res) => {
      const bookingData = req.body;
      const result = await bookingsCollection.insertOne(bookingData);
      sendMail({
        subject: "A new booking has been made",
        bookingId: result?.insertedId,
        bookingData,
      });
      res.send(result);
    });

    // Get All Bookings
    app.get("/allbookings", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const booking = await bookingsCollection.find(query).toArray();
      res.send(booking);
    });

    // Get Bookings for a user
    app.get("/userbookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { guestEmail: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // Get Bookings for a host
    app.get("/hostbookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { hostEmail: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // delete a booking
    app.delete("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // Sslcommerz payment
    app.post("/ssl-payment", verifyJWT, async (req, res) => {
      const data = {
        total_amount: 100,
        currency: "BDT",
        tran_id: new ObjectId().toString(), // use unique tran_id for each api call
        success_url: "http://localhost:3030/success",
        fail_url: "http://localhost:3030/fail",
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: "Customer Name",
        cus_email: "customer@example.com",
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });
      });
    });

    // Create Payment Intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const price = req.body.price;
      const amount = parseFloat(price);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.log(err);
      }
    });

    // Get search result
    app.get("/search-result", async (req, res) => {
      const { location, from, to, price, category } = req.query;
      let query = {
        location: location,
        category: category,
        isBooked: { $ne: true },
      };

      if (price) {
        query.price = { $lte: parseInt(price) };
      }

      if (from && to) {
        const homes = await homesCollection.find(query).toArray();
        const filteredHomes = homes.filter((home) => {
          const homeFrom = new Date(home.from);
          const homeTo = new Date(home.to);
          const searchFrom = new Date(from);
          const searchTo = new Date(to);
          if (homeFrom <= searchFrom && homeTo >= searchTo) {
            return true;
          }
          return false;
        });
        return res.send(filteredHomes);
      }

      const homes = await homesCollection.find(query).toArray();
      return res.send(homes);
    });
  } finally {
  }
}

run().catch((err) => console.error(err));

app.get("/", (req, res) => {
  res.send("Server is running...");
});

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});

var express = require('express');
var router = express.Router();
const path = require('path')
const {resizeAndCropImage} = require('../../plugins/sharp/sharp')
const { sendDynamicEmail } = require('../../plugins/nodemailer/setup');
const upload = require('../../plugins/multer/setup');
const { getDb } = require('../../plugins/mongo/mongo');
const { ObjectId } = require('mongodb');
const config = require('../../config/config'); // Import config if you're using it
const lib = require('../logFunctions/logFunctions')
const fs = require('fs')
const fsp = require('fs').promises
const sharp = require('sharp')
// Function to handle user data upload
async function userDataUpload(req, res) {
  try {
    const db = getDb();
    const user = req.user; // Assuming user data is available via passport authentication
    const collection = db.collection('users'); // Adjust the collection name as needed
    const referredBy= req.body.card_id
    
    // Retrieve user data from the request body
    const { firstName, lastName,chapter, address, email, phone, birthday_month,birthday_day,age,title } = req.body;

    // Update the user's data in the database
    await collection.updateOne(
      { _id: user._id }, // Assuming you have a user ID in your user model
      {
        $set: {
          firstName,
          lastName,       
          address,      
          phone,
          birthday_day,
          birthday_month,
     
          
      
        },
      }
    );
console.log(`user updated data ${user.email}`)
req.flash('success', 'User data updated successfully.');
res.redirect(`/viewBuy/?_id=${referredBy}`); // Redirect to the user setup page or any other appropriate page
} catch (err) {
  console.error(err);
  req.flash('error', 'An error occurred while updating user data.');
  res.redirect(`/viewBuy/?_id=${referredBy}`); // Redirect to the user setup page or any other appropriate page
}
}
// Function to handle user headshot upload
const userImgUpload = async (req, res) => {
  let referredBy; // Declare referredBy variable outside the try block
  try {
    console.log('Starting user image upload process.', req.file);
    const db = getDb();
    const user = req.user;
    const collection = db.collection('users');

    if (req.body.card_id) {
      referredBy = req.body.card_id;
      console.log(`referred by: ${referredBy}`);
    }

    const uploadDirectory = path.join(__dirname, '../../public/images/uploads'); // Directory where files are initially uploaded
    const headshotDirectory = path.join(__dirname, '../../public/images/userHeadshots'); // Directory where final images will be stored

    if (!req.files || !req.files.userImg || req.files.userImg.length === 0) {
      console.log('No file uploaded.');
      req.flash('info', 'No file uploaded.');
      return res.redirect('/');
    }

    const uploadedFile = req.files.userImg[0];

    // Validate file type (allow only JPG, JPEG, and PNG)
    const allowedFileTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedFileTypes.includes(uploadedFile.mimetype)) {
      if (!referredBy) {
        req.flash('error', 'Can only use JPG, JPEG, or PNG.');
        return res.redirect('/');
      } else {
        req.flash('error', 'Can only use JPG, JPEG, or PNG.');
        return res.redirect(`/viewBuy/?_id=${referredBy}`);
      }
    }

    const originalFilePath = path.join(uploadDirectory, uploadedFile.filename);

    // Use Sharp only if the file type is allowed
    const headshotPath = `${headshotDirectory}/${uploadedFile.filename}`;
    const existingHeadshotPath = path.join(headshotDirectory, user.userImg || '');
    if (fs.existsSync(existingHeadshotPath) && user.userImg) {
      await fs.promises.unlink(existingHeadshotPath);
      console.log('Existing headshot deleted.');
    }

    // Trigger image resizing only if the file type is allowed
    const resizedImagePath = await resizeAndCropImage(
      originalFilePath, // Original file path
      headshotDirectory, // Output directory for final image
      uploadedFile.filename // Output filename
    );

    // Delete the original file from the uploads directory
    fs.unlink(originalFilePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
        // Handle error
      } else {
        console.log('File deleted successfully');
      }
    });

    // Update the user's headshot path in the database
    const result = await collection.updateOne(
      { _id: user._id },
      { $set: { userImg: headshotPath.replace(/^.*[\\\/]/, '') } } // Storing only the filename in the database
    );

    console.log(`User updated headshot ${user.email}`);
    req.flash('success', 'Headshot updated successfully.');

    if (referredBy) {
      res.redirect(`/viewBuy/?_id=${referredBy}`);
    } else {
      res.redirect('/');
    }
  } catch (err) {
    console.log('Error in user image upload:', err);
    req.flash('error', 'An error occurred while updating the headshot.');
    if (referredBy) {
      res.redirect(`/`);
    } else {
      res.redirect('/');
    }
  }
};

const submitTicket = async (req, res) => {
  try {
    const db = getDb();
    const collection = db.collection('tickets');
    const userCollection = db.collection('users');

    const user = req.user;
    const userId = user._id;
    const { subject, description } = req.body;

    const ticket = {
      userId: new ObjectId(userId),
      userEmail: user.email,
      userName: user.firstName,
      userPhone: user.phone,
      subject: subject,
      description: description,
      devUpdates: { timestamp: new Date(), message: "Hi!, you can see your ticket updates here" },
      status: 'open',
      createdAt: new Date()
    };

    const result = await collection.insertOne(ticket);

    if (result.acknowledged === true) {
      const ticketId = result.insertedId;

      // Update user with ticket object
      await userCollection.updateOne(
        { _id: userId },
        { $push: { tickets: ticket._id } }
      );

      const adminEmail = config.ticketsEmail; // Replace with actual user email
      const userFirstName = user.firstName; // Replace with actual user first name
      const dynamicLink = config.baseUrl; // Customize this link
      const ticketInfo = {
        userId: ticket.userId.toString(),
        userEmail: ticket.userEmail,
        userName: ticket.userName,
        userPhone: ticket.userPhone,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString()
      };
      // Send email notification
      //await sendDynamicEmail(adminEmail, 'ticketAdded', { firstName: user.FirstName },null,  dynamicLink,ticketInfo);
      lib('ticket added', 'no errors from lib()', { ticketInfo }, 'tickets.json', 'data');
      req.flash('success', 'Ticket submitted successfully.');
    } else {
      console.log("Ticket Submission Error - No Document Inserted DB did not acknowledge receipt of ticket");
      req.flash('error', 'Error submitting ticket no db acknowledgement.');
    }
  } catch (err) {
    console.error("Error in Submit Ticket: ", err);
    req.flash('error', 'An error occurred while submitting the ticket.');
  }

  const backURL = req.header('Referer') || '/';
  console.log("Redirecting to: ", backURL);
  res.redirect(backURL);
};

async function saveRotation(req, res) {
  try {
    const { rotation, file } = req.body;

    // Directory where final images will be stored
    const headshotDirectory = path.join(__dirname, '../../public/images/userHeadshots/');

    // Filepath of the image to be rotated
    const imagePath = path.join(headshotDirectory, file);
console.log(imagePath)
    // Load the image using Sharp
    const imageBuffer = await sharp(imagePath).rotate(rotation).toBuffer();

    // Remove the original image file
   // await fs.unlink(imagePath);

    // Save the rotated image back to the same file
    await fsp.writeFile(imagePath, imageBuffer);

    res.status(200).json({ message: 'Rotation saved successfully' });
  } catch (error) {
    console.error('Error saving rotation:', error);
    res.status(500).json({ error: 'Failed to save rotation' });
  }
}

//router.post('/userImgUpload', upload, userImgUpload);

router.post('/userDataUpload', userDataUpload)

module.exports = { userDataUpload, userImgUpload, submitTicket ,saveRotation};

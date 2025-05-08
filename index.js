// Import required modules
const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const multer = require("multer");
const bcrypt = require("bcrypt");

// Create Express application
const app = express();

// Setup session
app.use(
    session({
        secret: "strontium",
        resave: false,
        saveUninitialized: true,
    }),
);

//Loads the handlebars module
const handlebars = require("express-handlebars");

// Middleware setup
app.use(express.json());
app.use(
    express.urlencoded({
        extended: true,
    }),
);

// Static folder to serve uploaded images
app.use("/data/uploads", express.static("uploads"));

// Setup Multer for image upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, "/data/uploads/")); // save inside 'uploads' folder
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)); // e.g., 1681234567890.jpg
    },
});

const upload = multer({ storage: storage });

// Initialize json files if it doesn't exist
const periodicRatingsFilePath = path.join(
    __dirname,
    "data",
    "periodic-ratings.json",
);
const studentsFilePath = path.join(__dirname, "data", "students.json");
const subjectsFilePath = path.join(__dirname, "data", "subjects.json");

if (!fs.existsSync(path.join(__dirname, "data"))) {
    console.log("Creating data directory...");
    fs.mkdirSync(path.join(__dirname, "data"));
}

if (!fs.existsSync(periodicRatingsFilePath)) {
    console.log("Creating periodic-ratings.json file...");
    fs.writeFileSync(periodicRatingsFilePath, "{}");
}

if (!fs.existsSync(studentsFilePath)) {
    console.log("Creating students.json file...");
    fs.writeFileSync(studentsFilePath, "{}");
}

if (!fs.existsSync(subjectsFilePath)) {
    console.log("Creating subjects.json file...");
    fs.writeFileSync(subjectsFilePath, "{}");
}

// Setup Handlebars helpers
const hbs = handlebars.create();
hbs.handlebars.registerHelper("formatDate", function (dateString) {
    if (dateString != null) {
        return new hbs.handlebars.SafeString(
            moment(dateString).format("MM/DD/yyyy h:mm a").toUpperCase(),
        );
    } else {
        return new hbs.handlebars.SafeString("");
    }
});

hbs.handlebars.registerHelper("ifEquals", function (arg1, arg2, options) {
    return arg1 == arg2 ? options.fn(this) : options.inverse(this);
});

// Setup view engine
app.engine(
    "hbs",
    handlebars.engine({
        layoutsDir: __dirname + "/views/layouts",
        partialsDir: __dirname + "/views/partials/",
        extname: "hbs",
    }),
);

app.use(express.static("public")); // Serve static files from 'public' directory
app.use("/data", express.static(path.join(__dirname, "data")));

// Set up handlebars as the template engine
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views")); // Updated path for views

// Route: Render login page
app.get("/", (req, res) => {
    try {
        res.render("login.hbs", {
            layout: "main",
            title: "Login",
        });
    } catch (error) {
        console.error("Error loading login page:", error);
        res.status(500).send("Error loading login page");
    }
});

// Route: Render dashboard page
app.get("/dashboard", ensureAuthenticated, (req, res) => {
    try {
        let username = req.session.username;
        let students = sort(studentsFilePath, "name", "asc");
        let user = findUserByEmail(username, students);

        let chart = {};
        let grades = {};

        if (user.is_student) {
            let id = findKeyByEmail(username, students);
            chart = createSubjectPerQuarterChart(id) || {};
        } else {
            chart = createGradesPerStudent() ?? {};
            grades = createHighestGradePerSubject() ?? {};
        }

        res.render("dashboard.hbs", {
            layout: "template",
            title: "Dashboard",
            user: user,
            chart: JSON.stringify(chart),
            grades: JSON.stringify(grades),
        });
    } catch (error) {
        console.error("Error loading dashboard page:", error);
        res.status(500).send("Error loading dashboard page");
    }
});

// Route: Render students page
app.get("/students", ensureAuthenticated, (req, res) => {
    try {
        let username = req.session.username;
        let students = sort(studentsFilePath, "first_name", "asc");
        let user = findUserByEmail(username, students);

        students = Object.fromEntries(
            Object.entries(students).filter(([id, user]) => user.is_student),
        );

        res.render("students.hbs", {
            layout: "template",
            students: students,
            title: "Students",
            user: user,
            chart: JSON.stringify({}),
            grades: JSON.stringify({}),
        });
    } catch (error) {
        console.error("Error loading students page:", error);
        res.status(500).send("Error loading students page");
    }
});

// Route: Save or update student information
app.post("/save-student", upload.single("profile_image"), async (req, res) => {
    try {
        let isFound = false;

        const students = JSON.parse(fs.readFileSync(studentsFilePath));
        const data = req.body;

        const profileImagePath =
            "/data/uploads/" + (req.file ? req.file.filename : "none.png");

        for (let key in students) {
            if (key == data.id) {
                students[key].first_name = data.first_name;
                students[key].middle_name = data.middle_name;
                students[key].last_name = data.last_name;
                students[key].date_of_birth = data.date_of_birth;
                students[key].email_address = data.email_address;
                students[key].is_student = true;
                students[key].profile_image =
                    profileImagePath ?? students[key].profile_image;
                students[key].modified_date = new Date();

                isFound = true;
            }
        }

        if (!isFound) {
            let hashedPassword = await bcrypt.hash("P@ssw0rd1234", 10);

            students[data.id] = {
                first_name: data.first_name,
                middle_name: data.middle_name,
                last_name: data.last_name,
                date_of_birth: data.date_of_birth,
                email_address: data.email_address,
                is_student: true,
                profile_image: profileImagePath ?? null,
                password: hashedPassword,
                created_date: new Date(),
                modified_date: null,
            };
        }

        console.log("Saving updated student data...");
        fs.writeFileSync(studentsFilePath, JSON.stringify(students, null, 2));
        console.log("Student data saved successfully");

        res.redirect("/students");
    } catch (error) {
        console.error("Error reading student file:", error);
        res.status(500).send("Error loading student data");
    }
});

// Route: Delete student record
app.get("/delete-student", (req, res) => {
    try {
        let id = req.query;

        const students = JSON.parse(fs.readFileSync(studentsFilePath));
        for (let key in id) {
            delete students[key];
        }

        console.log("Saving updated student data...");
        fs.writeFileSync(studentsFilePath, JSON.stringify(students, null, 2));
        console.log("Student data saved successfully");

        const ratings = fs.readFileSync(periodicRatingsFilePath, "utf-8");
        for (let key in id) {
            delete ratings[key];
        }

        console.log("Saving period ratings data...");
        fs.writeFileSync(
            periodicRatingsFilePath,
            JSON.stringify(ratings, null, 2),
        );
        console.log("Period ratings data successfully");

        res.redirect("/students");
    } catch (error) {
        console.error("Error reading student file:", error);
        res.status(500).send("Error loading student data");
    }
});

// Route: Render subjects page
app.get("/subjects", ensureAuthenticated, (req, res) => {
    try {
        let username = req.session.username;
        let students = sort(studentsFilePath, "name", "asc");
        let user = findUserByEmail(username, students);

        let subjects = sort(subjectsFilePath, "name", "asc");
        res.render("subjects.hbs", {
            layout: "template",
            subjects: subjects,
            title: "Subjects",
            user: user,
            chart: JSON.stringify({}),
            grades: JSON.stringify({}),
        });
    } catch (error) {
        console.error("Error loading subjects page:", error);
        res.status(500).send("Error loading subjects page");
    }
});

// Route: Save or update subject information
app.post("/save-subject", (req, res) => {
    try {
        let isFound = false;

        const subjects = JSON.parse(fs.readFileSync(subjectsFilePath));
        const data = req.body;

        console.log(JSON.stringify(data));

        for (let key in subjects) {
            if (Number(key) == Number(data.id)) {
                subjects[key].name = data.name;
                subjects[key].descriptive_title = data.descriptive_title;
                subjects[key].credit_unit = data.credit_unit;
                subjects[key].is_included = data.is_included;
                subjects[key].modified_date = new Date();

                isFound = true;
            }
        }

        if (!isFound) {
            subjects[data.id] = {
                name: data.name,
                descriptive_title: data.descriptive_title,
                credit_unit: data.credit_unit,
                is_included: data.is_included,
                created_date: new Date(),
                modified_date: null,
            };
        }

        console.log("Saving updated subject data...");
        fs.writeFileSync(subjectsFilePath, JSON.stringify(subjects, null, 2));
        console.log("Subject data saved successfully");

        res.redirect("/subjects");
    } catch (error) {
        console.error("Error reading subject file:", error);
        res.status(500).send("Error loading subject data");
    }
});

// Route: Delete subject record
app.get("/delete-subject", (req, res) => {
    try {
        const subjects = JSON.parse(fs.readFileSync(subjectsFilePath));
        let id = req.query;

        for (let key in id) {
            delete subjects[key];
        }

        console.log("Saving updated subject data...");
        fs.writeFileSync(subjectsFilePath, JSON.stringify(subjects, null, 2));
        console.log("Subject data saved successfully");

        res.redirect("/subjects");
    } catch (error) {
        console.error("Error reading subject file:", error);
        res.status(500).send("Error loading subject data");
    }
});

// Route: Render periodic ratings page
app.get("/periodic-ratings", ensureAuthenticated, (req, res) => {
    try {
        let id = req.query.id;
        let username = req.session.username;

        const data = fs.readFileSync(periodicRatingsFilePath, "utf-8");
        let ratings = JSON.parse(data);

        let students = sort(studentsFilePath, "name", "asc");
        const subjects = sort(subjectsFilePath, "name", "asc");

        let user = findUserByEmail(username, students);
        if (user.is_student) {
            id = findKeyByEmail(username, students);
        }

        if (id != null) {
            let student = search(ratings, id);
            if (student != null) {
                enrichPeriodicRatings(id, subjects, ratings);
            } else {
                ratings = {};
                addStudentIfNotExists(id, subjects, ratings);
            }

            ratings = search(ratings, id);
        } else {
            ratings = {};
        }

        students = Object.fromEntries(
            Object.entries(students).filter(([id, user]) => user.is_student),
        );

        res.render("periodic-ratings.hbs", {
            layout: "template",
            ratings: ratings,
            students: students,
            id: id,
            title: "Periodic Ratings",
            user: user,
            chart: JSON.stringify({}),
            grades: JSON.stringify({}),
        });
    } catch (error) {
        console.error("Error loading period ratings page:", error);
        res.status(500).send("Error loading period ratings page");
    }
});

// Route: Save periodic ratings
app.post("/save-periodic-ratings", (req, res) => {
    try {
        let periodicRatings = {};

        periodicRatings = JSON.parse(fs.readFileSync(periodicRatingsFilePath));

        const body = JSON.stringify(req.body);
        const data = JSON.parse(body);

        for (const studentId in data) {
            if (data.hasOwnProperty(studentId)) {
                periodicRatings[studentId] = data[studentId];
            }
        }

        periodicRatings = sortByKeys(periodicRatings);

        fs.writeFile(
            periodicRatingsFilePath,
            JSON.stringify(periodicRatings, null, 2),
            (err) => {
                if (err) {
                    console.error("Error saving periodic ratings file:", err);
                    return res.status(500).json({
                        message: "Failed to save periodic ratings data.",
                    });
                }

                res.json({ message: "Periodic ratings saved successfully!" });
            },
        );
    } catch (error) {
        console.error("Error loading period ratings data:", error);
        res.status(500).send("Error loading period ratings data");
    }
});

// Route: Handle login authentication
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        let students = sort(studentsFilePath, "name", "asc");
        let user = findUserByEmail(username, students);

        if (user) {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.isAuthenticated = true;
                req.session.username = username;
                res.redirect("/dashboard");
            }
        } else {
            res.render("login", { error: "Invalid username or password!" });
        }
    } catch (error) {
        console.error("Error loading login page:", error);
        res.status(500).send("Error loading login page");
    }
});

// Route: Logout and destroy session
app.get("/logout", (req, res) => {
    try {
        req.session.destroy();
        res.redirect("/");
    } catch (error) {
        console.error("Error logout page:", error);
        res.status(500).send("Error logout page");
    }
});

// Helper: Sort JSON by key
function sort(filePath, key, order = "asc") {
    try {
        const rawData = fs.readFileSync(filePath, "utf-8");
        const jsonData = JSON.parse(rawData);

        const sortedEntries = Object.entries(jsonData).sort(([, a], [, b]) => {
            if (a[key] < b[key]) return order === "asc" ? -1 : 1;
            if (a[key] > b[key]) return order === "asc" ? 1 : -1;
            return 0;
        });

        const sortedJson = {};
        sortedEntries.forEach(([id, item]) => {
            sortedJson[id] = item;
        });

        fs.writeFileSync(
            filePath,
            JSON.stringify(sortedJson, null, 2),
            "utf-8",
        );

        console.log(`Successfully sorted by "${key}" in ${order} order.`);
        return sortedJson;
    } catch (error) {
        console.error("Error sorting JSON file:", error.message);
    }
}

// Helper: Search key inside JSON
function search(data, key) {
    try {
        if (data.hasOwnProperty(key)) {
            return data[key];
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error searching key:", error.message);
    }
}

// Helper: Enrich periodic ratings with subject data
function enrichPeriodicRatings(studentId, subjectsData, ratingsData) {
    try {
        ratingsData[studentId].forEach((record) => {
            const existingSubjectIds = record.subjects.map(
                (subject) => subject.id,
            );

            record.subjects = record.subjects.filter((subject) => {
                const subjectInfo = subjectsData[subject.id];
                if (subjectInfo) {
                    subject.name = subjectInfo.name;
                    subject.descriptive_title = subjectInfo.descriptive_title;
                    subject.credit_unit = subjectInfo.credit_unit;
                    subject.is_included = subjectInfo.is_included;
                    return true;
                }
                return false;
            });


            for (const subjectId in subjectsData) {
                if (!existingSubjectIds.includes(subjectId)) {
                    const subjectInfo = subjectsData[subjectId];
                    record.subjects.push({
                        id: subjectId,
                        name: subjectInfo.name,
                        descriptive_title: subjectInfo.descriptive_title,
                        credit_unit: subjectInfo.credit_unit,
                        is_included: subjectInfo.is_included,
                        quarters: {
                            quarter1: 0,
                            quarter2: 0,
                            quarter3: 0,
                            quarter4: 0,
                        },
                    });
                }
            }
        });
    } catch (error) {
        console.error("Error enrich periodic ratings:", error.message);
    }
}

// Helper: Add student if not exists in ratings
function addStudentIfNotExists(studentId, subjectsData, ratingsData) {
    try {
        const subjectsList = Object.keys(subjectsData).map((subjectId) => ({
            id: subjectId,
            name: subjectsData[subjectId].name,
            descriptive_title: subjectsData[subjectId].descriptive_title,
            credit_unit: subjectsData[subjectId].credit_unit,
            is_included: subjectsData[subjectId].is_included,
            quarters: {
                quarter1: 0,
                quarter2: 0,
                quarter3: 0,
                quarter4: 0,
            },
        }));

        ratingsData[studentId] = [
            {
                subjects: subjectsList,
                general_weighted_average: {
                    quarter1: 0,
                    quarter2: 0,
                    quarter3: 0,
                    quarter4: 0,
                },
            },
        ];
    } catch (error) {
        console.error("Error add student if not exists:", error.message);
    }
}

// Helper: Sort JSON object by its keys
function sortByKeys(obj) {
    try {
        const sortedKeys = Object.keys(obj).sort();
        const sortedObj = {};

        for (const key of sortedKeys) {
            sortedObj[key] = obj[key];
        }

        return sortedObj;
    } catch (error) {
        console.error("Error sort by keys:", error.message);
    }
}

// Middleware: Check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.redirect("/");
}

// Helper: Find user object by email
function findUserByEmail(email, users) {
    try {
        for (const key in users) {
            if (users[key].email_address === email) {
                return users[key];
            }
        }
        return null;
    } catch (error) {
        console.error("Error find user by email:", error.message);
    }
}

// Helper: Find user key by email
function findKeyByEmail(email, users) {
    try {
        for (const key in users) {
            if (users[key].email_address === email) {
                return key;
            }
        }
        return null;
    } catch (error) {
        console.error("Error find key by email:", error.message);
    }
}

// Chart Helper: Create subject per quarter chart data
function createSubjectPerQuarterChart(studentId) {
    try {
        const data = JSON.parse(fs.readFileSync(subjectsFilePath));

        const subjects = Object.entries(data)
            .filter(([id, subject]) => subject.is_included == "yes")
            .reduce((acc, [id, subject]) => {
                acc[id] = subject;
                return acc;
            }, {});

        const periodicRatings = JSON.parse(
            fs.readFileSync(periodicRatingsFilePath),
        );

        const studentData = periodicRatings[studentId][0];
        const chartData = studentData.subjects
            .map((subject) => {
                if (!subjects[subject.id]) return null;
                return {
                    label: subjects[subject.id]?.name,
                    quarter1: subject.quarters.quarter1,
                    quarter2: subject.quarters.quarter2,
                    quarter3: subject.quarters.quarter3,
                    quarter4: subject.quarters.quarter4,
                };
            })
            .filter((item) => item !== null);

        return chartData;
    } catch (error) {
        console.error("Error create subject per quarter chart:", error.message);
    }
}

// Chart Helper: Create grades per student chart data
function createGradesPerStudent() {
    try {
        const periodicRatings = JSON.parse(
            fs.readFileSync(periodicRatingsFilePath),
        );
        const students = JSON.parse(fs.readFileSync(studentsFilePath));

        const chartData = Object.keys(periodicRatings).map((studentId) => {
            const student = periodicRatings[studentId][0];
            return {
                studentName: students[studentId] || studentId,
                quarter1: student.general_weighted_average.quarter1,
                quarter2: student.general_weighted_average.quarter2,
                quarter3: student.general_weighted_average.quarter3,
                quarter4: student.general_weighted_average.quarter4,
            };
        });

        return chartData;
    } catch (error) {
        console.error("Error create grades per student:", error.message);
    }
}

// Chart Helper: Create highest grade per subject chart data
function createHighestGradePerSubject() {
    try {
        const subjects = JSON.parse(fs.readFileSync(subjectsFilePath));
        const periodicRatings = JSON.parse(
            fs.readFileSync(periodicRatingsFilePath),
        );

        const highestGrades = {};
        for (const subjectId in subjects) {
            if (subjects[subjectId].is_included == "yes") {
                highestGrades[subjectId] = {
                    name: subjects[subjectId].name,
                    quarter1: 0,
                    quarter2: 0,
                    quarter3: 0,
                    quarter4: 0,
                };
            }
        }

        for (const studentId in periodicRatings) {
            const studentRecords = periodicRatings[studentId];

            studentRecords.forEach((record) => {
                record.subjects.forEach((subject) => {
                    const sid = subject.id;
                    const quarters = subject.quarters;
                    if (highestGrades[sid]) {
                        highestGrades[sid].quarter1 = Math.max(
                            highestGrades[sid].quarter1,
                            quarters.quarter1,
                        );
                        highestGrades[sid].quarter2 = Math.max(
                            highestGrades[sid].quarter2,
                            quarters.quarter2,
                        );
                        highestGrades[sid].quarter3 = Math.max(
                            highestGrades[sid].quarter3,
                            quarters.quarter3,
                        );
                        highestGrades[sid].quarter4 = Math.max(
                            highestGrades[sid].quarter4,
                            quarters.quarter4,
                        );
                    }
                });
            });
        }

        const chartData = {
            labels: Object.values(highestGrades).map((item) => item.name),
            datasets: [
                {
                    label: "Quarter 1",
                    data: Object.values(highestGrades).map(
                        (item) => item.quarter1,
                    ),
                },
                {
                    label: "Quarter 2",
                    data: Object.values(highestGrades).map(
                        (item) => item.quarter2,
                    ),
                },
                {
                    label: "Quarter 3",
                    data: Object.values(highestGrades).map(
                        (item) => item.quarter3,
                    ),
                },
                {
                    label: "Quarter 4",
                    data: Object.values(highestGrades).map(
                        (item) => item.quarter4,
                    ),
                },
            ],
        };

        return chartData;
    } catch (error) {
        console.error("Error create highest grade per subject:", error.message);
    }
}

// Start server
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});

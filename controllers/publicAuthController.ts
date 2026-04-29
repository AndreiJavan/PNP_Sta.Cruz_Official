import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';

export const getLogin = (req: Request, res: Response) => {
    // If they already have an active public session, send them to tip
    if (req.session.user && req.session.user.role === 'public') {
        return res.redirect('/tip');
    }
    const redirect = req.query.redirect || '/';
    res.render('public/login', { title: 'Login', redirect });
};

export const postLogin = async (req: Request, res: Response) => {
    const { email, password, redirect_url } = req.body;

    try {
        const usersSnap = await db.collection('public_users')
            .where('email', '==', email).get();

        if (usersSnap.empty) {
            return res.render('public/login', {
                title: 'Login',
                error: 'Invalid credentials',
                redirect: redirect_url
            });
        }

        const userDoc = usersSnap.docs[0];
        const user = { id: userDoc.id, ...userDoc.data() };

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.render('public/login', {
                title: 'Login',
                error: 'Invalid credentials',
                redirect: redirect_url
            });
        }

        req.session.user = {
            id: user.id,
            email: user.email,
            name: user.full_name,
            role: 'public'
        };

        res.redirect(redirect_url || '/');
    } catch (err) {
        console.error(err);
        res.render('public/login', { title: 'Login', error: 'Server error', redirect: redirect_url });
    }
};

export const getRegister = (req: Request, res: Response) => {
    if (req.session.user && req.session.user.role === 'public') {
        return res.redirect('/tip');
    }
    res.render('public/register', { title: 'Register' });
};

export const postRegister = async (req: Request, res: Response) => {
    const { full_name, email, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.render('public/register', { title: 'Register', error: 'Passwords do not match' });
    }

    try {
        const existingSnap = await db.collection('public_users')
            .where('email', '==', email).get();

        if (!existingSnap.empty) {
            return res.render('public/register', { title: 'Register', error: 'Email already exists' });
        }

        // Mock ID creation logic (usually Handled by Document DB, but explicitly done for clean mock mapping)
        const newId = `user_${Date.now()}`;
        const password_hash = await bcrypt.hash(password, 10);

        await db.collection('public_users').doc(newId).set({
            email,
            full_name,
            password_hash,
            created_at: new Date().toISOString()
        });

        // Auto-login
        req.session.user = {
            id: newId,
            email,
            name: full_name,
            role: 'public'
        };

        res.redirect('/tip');
    } catch (err) {
        console.error(err);
        res.render('public/register', { title: 'Register', error: 'Server error' });
    }
};

export const getLogout = (req: Request, res: Response) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
};

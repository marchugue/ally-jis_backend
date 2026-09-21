-- ==============================================================================
-- 020_fix_all_user_deletion_cascades.sql
--
-- COMPREHENSIVE FIX FOR SUPABASE AUTHENTICATION USER DELETION
--
-- Fixes foreign key constraints across ALL schemas (public, storage, etc.)
-- so that deleting a user from the Supabase Dashboard (Authentication -> Users)
-- cascades cleanly without foreign key violations.
-- ==============================================================================

DO $$
DECLARE
    rec RECORD;
    fk_rec RECORD;
    dyn_rec RECORD;
BEGIN

    -- ──────────────────────────────────────────────────────────────────────────
    -- 1. STORAGE SCHEMA FIXES (storage.objects, storage.s3_multipart_uploads)
    -- When users upload avatars/photos, storage.objects references auth.users(id).
    -- By default in Supabase, this lacks ON DELETE CASCADE, blocking deletion.
    -- ──────────────────────────────────────────────────────────────────────────
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
        FOR fk_rec IN (
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'storage' AND tc.table_name = 'objects'
              AND kcu.column_name = 'owner' AND tc.constraint_type = 'FOREIGN KEY'
        ) LOOP
            EXECUTE format('ALTER TABLE storage.objects DROP CONSTRAINT IF EXISTS %I CASCADE;', fk_rec.constraint_name);
        END LOOP;

        ALTER TABLE storage.objects ALTER COLUMN owner DROP NOT NULL;
        ALTER TABLE storage.objects 
            ADD CONSTRAINT objects_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 's3_multipart_uploads') THEN
        FOR fk_rec IN (
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'storage' AND tc.table_name = 's3_multipart_uploads'
              AND kcu.column_name = 'owner_id' AND tc.constraint_type = 'FOREIGN KEY'
        ) LOOP
            EXECUTE format('ALTER TABLE storage.s3_multipart_uploads DROP CONSTRAINT IF EXISTS %I CASCADE;', fk_rec.constraint_name);
        END LOOP;

        ALTER TABLE storage.s3_multipart_uploads 
            ADD CONSTRAINT s3_multipart_uploads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- ──────────────────────────────────────────────────────────────────────────
    -- 2. PUBLIC SCHEMA: EXPLICIT RECONFIGURATION OF ALL USER-RELATED FOREIGN KEYS
    -- ──────────────────────────────────────────────────────────────────────────
    FOR rec IN 
        SELECT * FROM (VALUES
            -- 1. Profiles (Root connection from auth.users)
            ('profiles', 'id', 'auth', 'users', 'id', 'CASCADE', 'profiles_id_fkey'),

            -- 2. Social / Interactions
            ('user_interactions', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'user_interactions_user_id_fkey'),
            ('user_interactions', 'target_user_id', 'public', 'profiles', 'id', 'CASCADE', 'user_interactions_target_user_id_fkey'),
            ('follows', 'follower_id', 'public', 'profiles', 'id', 'CASCADE', 'follows_follower_id_fkey'),
            ('follows', 'followed_id', 'public', 'profiles', 'id', 'CASCADE', 'follows_followed_id_fkey'),
            ('blocks', 'blocker_id', 'public', 'profiles', 'id', 'CASCADE', 'blocks_blocker_id_fkey'),
            ('blocks', 'blocked_id', 'public', 'profiles', 'id', 'CASCADE', 'blocks_blocked_id_fkey'),
            ('user_presence', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'user_presence_user_id_fkey'),

            -- 3. Conversations, Messaging & Reactions
            ('conversation_members', 'conversation_id', 'public', 'conversations', 'id', 'CASCADE', 'conversation_members_conversation_id_fkey'),
            ('conversation_members', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'conversation_members_user_id_fkey'),
            ('messages', 'conversation_id', 'public', 'conversations', 'id', 'CASCADE', 'messages_conversation_id_fkey'),
            ('messages', 'sender_id', 'public', 'profiles', 'id', 'CASCADE', 'messages_sender_id_fkey'),
            ('messages', 'reply_to_message_id', 'public', 'messages', 'id', 'SET NULL', 'messages_reply_to_message_id_fkey'),
            ('message_reactions', 'message_id', 'public', 'messages', 'id', 'CASCADE', 'message_reactions_message_id_fkey'),
            ('message_reactions', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'message_reactions_user_id_fkey'),
            ('message_deletions', 'message_id', 'public', 'messages', 'id', 'CASCADE', 'message_deletions_message_id_fkey'),
            ('message_deletions', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'message_deletions_user_id_fkey'),
            ('deleted_messages_user', 'user_id', 'auth', 'users', 'id', 'CASCADE', 'deleted_messages_user_user_id_fkey'),
            ('deleted_messages_user', 'message_id', 'public', 'messages', 'id', 'CASCADE', 'deleted_messages_user_message_id_fkey'),
            ('conversation_daily_activity', 'conversation_id', 'public', 'conversations', 'id', 'CASCADE', 'conversation_daily_activity_conversation_id_fkey'),
            ('conversation_daily_activity', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'conversation_daily_activity_user_id_fkey'),
            ('conversation_streaks', 'conversation_id', 'public', 'conversations', 'id', 'CASCADE', 'conversation_streaks_conversation_id_fkey'),
            ('conversation_streak_restores', 'conversation_id', 'public', 'conversations', 'id', 'CASCADE', 'conversation_streak_restores_conversation_id_fkey'),
            ('conversation_streak_restores', 'restored_by', 'public', 'profiles', 'id', 'CASCADE', 'conversation_streak_restores_restored_by_fkey'),

            -- 4. Feed, Posts, Likes & Comments
            ('posts', 'author_id', 'public', 'profiles', 'id', 'CASCADE', 'posts_author_id_fkey'),
            ('post_likes', 'post_id', 'public', 'posts', 'id', 'CASCADE', 'post_likes_post_id_fkey'),
            ('post_likes', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'post_likes_user_id_fkey'),
            ('post_comments', 'post_id', 'public', 'posts', 'id', 'CASCADE', 'post_comments_post_id_fkey'),
            ('post_comments', 'author_id', 'public', 'profiles', 'id', 'CASCADE', 'post_comments_author_id_fkey'),
            ('post_comments', 'parent_comment_id', 'public', 'post_comments', 'id', 'CASCADE', 'post_comments_parent_comment_id_fkey'),
            ('comment_likes', 'comment_id', 'public', 'post_comments', 'id', 'CASCADE', 'comment_likes_comment_id_fkey'),
            ('comment_likes', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'comment_likes_user_id_fkey'),
            ('post_media', 'post_id', 'public', 'posts', 'id', 'CASCADE', 'post_media_post_id_fkey'),

            -- 5. Notifications
            ('notifications', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'notifications_user_id_fkey'),
            ('notifications', 'from_user_id', 'public', 'profiles', 'id', 'SET NULL', 'notifications_from_user_id_fkey'),
            ('notifications', 'post_id', 'public', 'posts', 'id', 'CASCADE', 'notifications_post_id_fkey'),
            ('notifications', 'comment_id', 'public', 'post_comments', 'id', 'CASCADE', 'notifications_comment_id_fkey'),

            -- 6. Matchmaking
            ('matchmaking_queue', 'user_id', 'public', 'profiles', 'id', 'CASCADE', 'matchmaking_queue_user_id_fkey'),
            ('matches', 'user_a_id', 'public', 'profiles', 'id', 'CASCADE', 'matches_user_a_id_fkey'),
            ('matches', 'user_b_id', 'public', 'profiles', 'id', 'CASCADE', 'matches_user_b_id_fkey'),
            ('matches', 'last_sender_id', 'public', 'profiles', 'id', 'SET NULL', 'matches_last_sender_id_fkey'),
            ('matches', 'conversation_id', 'public', 'conversations', 'id', 'SET NULL', 'matches_conversation_id_fkey'),
            ('match_daily_activity', 'match_id', 'public', 'matches', 'id', 'CASCADE', 'match_daily_activity_match_id_fkey'),

            -- 7. Moderation, Audit & Settings (SET NULL to preserve audit history)
            ('reports', 'reporter_id', 'public', 'profiles', 'id', 'SET NULL', 'reports_reporter_id_fkey'),
            ('reports', 'reported_user_id', 'public', 'profiles', 'id', 'SET NULL', 'reports_reported_user_id_fkey'),
            ('reports', 'reviewed_by', 'public', 'profiles', 'id', 'SET NULL', 'reports_reviewed_by_fkey'),
            ('reports', 'conversation_id', 'public', 'conversations', 'id', 'SET NULL', 'reports_conversation_id_fkey'),
            ('reports', 'post_id', 'public', 'posts', 'id', 'SET NULL', 'reports_post_id_fkey'),
            ('admin_activity_log', 'admin_id', 'public', 'profiles', 'id', 'SET NULL', 'admin_activity_log_admin_id_fkey'),
            ('admin_activity_log', 'target_user_id', 'public', 'profiles', 'id', 'SET NULL', 'admin_activity_log_target_user_id_fkey'),
            ('system_settings', 'updated_by', 'public', 'profiles', 'id', 'SET NULL', 'system_settings_updated_by_fkey'),

            -- 8. Auth & Tokens
            ('email_otps', 'user_id', 'auth', 'users', 'id', 'CASCADE', 'email_otps_user_id_fkey'),
            ('password_reset_tokens', 'user_id', 'auth', 'users', 'id', 'CASCADE', 'password_reset_tokens_user_id_fkey')
        ) AS t(tbl, col, ref_sch, ref_tbl, ref_col, act, cname)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = rec.tbl 
              AND column_name = rec.col
        ) THEN
            -- Drop ANY existing foreign key constraint on this column
            FOR fk_rec IN (
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = rec.tbl
                  AND kcu.column_name = rec.col
                  AND tc.constraint_type = 'FOREIGN KEY'
            ) LOOP
                EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I CASCADE;', rec.tbl, fk_rec.constraint_name);
            END LOOP;

            -- If action is SET NULL, ensure column is nullable
            IF rec.act = 'SET NULL' THEN
                EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL;', rec.tbl, rec.col);
            END IF;

            -- Recreate foreign key with explicit CASCADE or SET NULL
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE %s;',
                rec.tbl, rec.cname, rec.col, rec.ref_sch, rec.ref_tbl, rec.ref_col, rec.act
            );
        END IF;
    END LOOP;

    -- ──────────────────────────────────────────────────────────────────────────
    -- 3. MULTI-SCHEMA DYNAMIC CATCH-ALL SWEEP
    -- Finds and fixes ANY foreign key across the entire database pointing to
    -- auth.users or public.profiles that still has NO ACTION or RESTRICT.
    -- ──────────────────────────────────────────────────────────────────────────
    FOR dyn_rec IN (
        SELECT 
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.delete_rule,
            tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND (
            (ccu.table_schema = 'auth' AND ccu.table_name = 'users')
            OR (ccu.table_schema = 'public' AND ccu.table_name = 'profiles')
          )
          AND rc.delete_rule NOT IN ('CASCADE', 'SET NULL')
    ) LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I CASCADE;',
            dyn_rec.table_schema, dyn_rec.table_name, dyn_rec.constraint_name);

        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE CASCADE;',
            dyn_rec.table_schema, dyn_rec.table_name, dyn_rec.constraint_name, dyn_rec.column_name,
            dyn_rec.foreign_table_schema, dyn_rec.foreign_table_name, dyn_rec.foreign_column_name);
    END LOOP;

    RAISE NOTICE 'SUCCESS: All cascades and storage foreign keys have been configured!';
END $$;

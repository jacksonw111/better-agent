CREATE INDEX "bridge_messages_turn_usage_idx" ON "bridge_messages" USING btree ("session_id","created_at") WHERE ("bridge_messages"."event"->>'status') = 'turn_usage';--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_agent_id_idx" ON "sessions" USING btree ("agent_id");
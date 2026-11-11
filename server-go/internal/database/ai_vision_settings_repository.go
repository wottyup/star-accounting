package database

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/wottyup/star-accounting/server-go/internal/vision"
)

func (store *Store) GetUserVisionSettings(ctx context.Context, userID string) (vision.UserSettings, bool, error) {
	database, err := store.connection()
	if err != nil {
		return vision.UserSettings{}, false, err
	}
	var settings vision.UserSettings
	err = database.QueryRowContext(ctx, `
		SELECT baseUrl, apiFormat, model, encryptedApiKey
		FROM useraivisionsetting WHERE userId = ? LIMIT 1`, userID).Scan(
		&settings.BaseURL, &settings.APIFormat, &settings.Model, &settings.EncryptedAPIKey,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return vision.UserSettings{}, false, nil
	}
	if err != nil {
		return vision.UserSettings{}, false, err
	}
	return settings, true, nil
}

func (store *Store) SaveUserVisionSettings(ctx context.Context, userID string, settings vision.UserSettings) error {
	database, err := store.connection()
	if err != nil {
		return err
	}
	_, err = database.ExecContext(ctx, `
		INSERT INTO useraivisionsetting (userId, baseUrl, apiFormat, model, encryptedApiKey, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE baseUrl = VALUES(baseUrl), apiFormat = VALUES(apiFormat), model = VALUES(model), encryptedApiKey = VALUES(encryptedApiKey), updatedAt = VALUES(updatedAt)`,
		userID, settings.BaseURL, settings.APIFormat, settings.Model, settings.EncryptedAPIKey, time.Now().UTC(),
	)
	return err
}

func (store *Store) DeleteUserVisionSettings(ctx context.Context, userID string) error {
	database, err := store.connection()
	if err != nil {
		return err
	}
	_, err = database.ExecContext(ctx, "DELETE FROM useraivisionsetting WHERE userId = ?", userID)
	return err
}

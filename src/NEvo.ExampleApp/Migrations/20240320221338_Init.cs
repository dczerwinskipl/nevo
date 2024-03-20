using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NEvo.ExampleApp.Migrations
{
    /// <inheritdoc />
    public partial class Init : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "__Inbox_InboxProcessedHandlers",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    HandlerKey = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK___Inbox_InboxProcessedHandlers", x => new { x.MessageId, x.HandlerKey })
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateTable(
                name: "__Inbox_InboxProcessedMessages",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK___Inbox_InboxProcessedMessages", x => x.MessageId)
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateIndex(
                name: "IX___Inbox_InboxProcessedHandlers_ProcessedAt",
                table: "__Inbox_InboxProcessedHandlers",
                column: "ProcessedAt")
                .Annotation("SqlServer:Clustered", true);

            migrationBuilder.CreateIndex(
                name: "IX___Inbox_InboxProcessedMessages_ProcessedAt",
                table: "__Inbox_InboxProcessedMessages",
                column: "ProcessedAt")
                .Annotation("SqlServer:Clustered", true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "__Inbox_InboxProcessedHandlers");

            migrationBuilder.DropTable(
                name: "__Inbox_InboxProcessedMessages");
        }
    }
}

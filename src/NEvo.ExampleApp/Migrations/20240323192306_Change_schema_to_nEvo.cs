using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NEvo.ExampleApp.Migrations
{
    /// <inheritdoc />
    public partial class Change_schema_to_nEvo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK___Outbox_OutboxMessages",
                table: "__Outbox_OutboxMessages");

            migrationBuilder.DropPrimaryKey(
                name: "PK___Inbox_InboxProcessedMessages",
                table: "__Inbox_InboxProcessedMessages");

            migrationBuilder.DropPrimaryKey(
                name: "PK___Inbox_InboxProcessedHandlers",
                table: "__Inbox_InboxProcessedHandlers");

            migrationBuilder.EnsureSchema(
                name: "nEvo");

            migrationBuilder.RenameTable(
                name: "__Outbox_OutboxMessages",
                newName: "OutboxMessages",
                newSchema: "nEvo");

            migrationBuilder.RenameTable(
                name: "__Inbox_InboxProcessedMessages",
                newName: "InboxProcessedMessages",
                newSchema: "nEvo");

            migrationBuilder.RenameTable(
                name: "__Inbox_InboxProcessedHandlers",
                newName: "InboxProcessedHandlers",
                newSchema: "nEvo");

            migrationBuilder.RenameIndex(
                name: "IX___Outbox_OutboxMessages_Status_Partition_Order",
                schema: "nEvo",
                table: "OutboxMessages",
                newName: "IX_OutboxMessages_Status_Partition_Order");

            migrationBuilder.RenameIndex(
                name: "IX___Outbox_OutboxMessages_Status_Order",
                schema: "nEvo",
                table: "OutboxMessages",
                newName: "IX_OutboxMessages_Status_Order");

            migrationBuilder.RenameIndex(
                name: "IX___Inbox_InboxProcessedMessages_ProcessedAt",
                schema: "nEvo",
                table: "InboxProcessedMessages",
                newName: "IX_InboxProcessedMessages_ProcessedAt");

            migrationBuilder.RenameIndex(
                name: "IX___Inbox_InboxProcessedHandlers_ProcessedAt",
                schema: "nEvo",
                table: "InboxProcessedHandlers",
                newName: "IX_InboxProcessedHandlers_ProcessedAt");

            migrationBuilder.AddPrimaryKey(
                name: "PK_OutboxMessages",
                schema: "nEvo",
                table: "OutboxMessages",
                column: "MessageId")
                .Annotation("SqlServer:Clustered", false);

            migrationBuilder.AddPrimaryKey(
                name: "PK_InboxProcessedMessages",
                schema: "nEvo",
                table: "InboxProcessedMessages",
                column: "MessageId")
                .Annotation("SqlServer:Clustered", false);

            migrationBuilder.AddPrimaryKey(
                name: "PK_InboxProcessedHandlers",
                schema: "nEvo",
                table: "InboxProcessedHandlers",
                columns: new[] { "MessageId", "HandlerKey" })
                .Annotation("SqlServer:Clustered", false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_OutboxMessages",
                schema: "nEvo",
                table: "OutboxMessages");

            migrationBuilder.DropPrimaryKey(
                name: "PK_InboxProcessedMessages",
                schema: "nEvo",
                table: "InboxProcessedMessages");

            migrationBuilder.DropPrimaryKey(
                name: "PK_InboxProcessedHandlers",
                schema: "nEvo",
                table: "InboxProcessedHandlers");

            migrationBuilder.RenameTable(
                name: "OutboxMessages",
                schema: "nEvo",
                newName: "__Outbox_OutboxMessages");

            migrationBuilder.RenameTable(
                name: "InboxProcessedMessages",
                schema: "nEvo",
                newName: "__Inbox_InboxProcessedMessages");

            migrationBuilder.RenameTable(
                name: "InboxProcessedHandlers",
                schema: "nEvo",
                newName: "__Inbox_InboxProcessedHandlers");

            migrationBuilder.RenameIndex(
                name: "IX_OutboxMessages_Status_Partition_Order",
                table: "__Outbox_OutboxMessages",
                newName: "IX___Outbox_OutboxMessages_Status_Partition_Order");

            migrationBuilder.RenameIndex(
                name: "IX_OutboxMessages_Status_Order",
                table: "__Outbox_OutboxMessages",
                newName: "IX___Outbox_OutboxMessages_Status_Order");

            migrationBuilder.RenameIndex(
                name: "IX_InboxProcessedMessages_ProcessedAt",
                table: "__Inbox_InboxProcessedMessages",
                newName: "IX___Inbox_InboxProcessedMessages_ProcessedAt");

            migrationBuilder.RenameIndex(
                name: "IX_InboxProcessedHandlers_ProcessedAt",
                table: "__Inbox_InboxProcessedHandlers",
                newName: "IX___Inbox_InboxProcessedHandlers_ProcessedAt");

            migrationBuilder.AddPrimaryKey(
                name: "PK___Outbox_OutboxMessages",
                table: "__Outbox_OutboxMessages",
                column: "MessageId")
                .Annotation("SqlServer:Clustered", false);

            migrationBuilder.AddPrimaryKey(
                name: "PK___Inbox_InboxProcessedMessages",
                table: "__Inbox_InboxProcessedMessages",
                column: "MessageId")
                .Annotation("SqlServer:Clustered", false);

            migrationBuilder.AddPrimaryKey(
                name: "PK___Inbox_InboxProcessedHandlers",
                table: "__Inbox_InboxProcessedHandlers",
                columns: new[] { "MessageId", "HandlerKey" })
                .Annotation("SqlServer:Clustered", false);
        }
    }
}

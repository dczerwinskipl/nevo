using System;
using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NEvo.ExampleApp.ServiceA.Api.Migrations
{
    /// <inheritdoc />
    [ExcludeFromCodeCoverage]
    public partial class Init : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "nEvo");

            migrationBuilder.CreateTable(
                name: "InboxProcessedHandlers",
                schema: "nEvo",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    HandlerKey = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InboxProcessedHandlers", x => new { x.MessageId, x.HandlerKey })
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateTable(
                name: "InboxProcessedMessages",
                schema: "nEvo",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InboxProcessedMessages", x => x.MessageId)
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateTable(
                name: "OutboxMessages",
                schema: "nEvo",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", maxLength: 2147483647, nullable: false),
                    MessageType = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    Headers = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: false),
                    PartitionKey = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    Partition = table.Column<int>(type: "int", nullable: false),
                    Order = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Status = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OutboxMessages", x => x.MessageId)
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InboxProcessedHandlers_ProcessedAt",
                schema: "nEvo",
                table: "InboxProcessedHandlers",
                column: "ProcessedAt")
                .Annotation("SqlServer:Clustered", true);

            migrationBuilder.CreateIndex(
                name: "IX_InboxProcessedMessages_ProcessedAt",
                schema: "nEvo",
                table: "InboxProcessedMessages",
                column: "ProcessedAt")
                .Annotation("SqlServer:Clustered", true);

            migrationBuilder.CreateIndex(
                name: "IX_OutboxMessages_Status_Order",
                schema: "nEvo",
                table: "OutboxMessages",
                columns: new[] { "Status", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxMessages_Status_Partition_Order",
                schema: "nEvo",
                table: "OutboxMessages",
                columns: new[] { "Status", "Partition", "Order" })
                .Annotation("SqlServer:Clustered", true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InboxProcessedHandlers",
                schema: "nEvo");

            migrationBuilder.DropTable(
                name: "InboxProcessedMessages",
                schema: "nEvo");

            migrationBuilder.DropTable(
                name: "OutboxMessages",
                schema: "nEvo");
        }
    }
}

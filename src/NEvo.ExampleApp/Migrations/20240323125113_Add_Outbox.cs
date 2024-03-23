using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NEvo.ExampleApp.Migrations
{
    /// <inheritdoc />
    public partial class Add_Outbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "__Outbox_OutboxMessages",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", maxLength: 2147483647, nullable: false),
                    MessageType = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    Headers = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: false),
                    Partition = table.Column<int>(type: "int", nullable: false),
                    Order = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Status = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK___Outbox_OutboxMessages", x => x.MessageId)
                        .Annotation("SqlServer:Clustered", false);
                });

            migrationBuilder.CreateIndex(
                name: "IX___Outbox_OutboxMessages_Status_Order",
                table: "__Outbox_OutboxMessages",
                columns: new[] { "Status", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX___Outbox_OutboxMessages_Status_Partition_Order",
                table: "__Outbox_OutboxMessages",
                columns: new[] { "Status", "Partition", "Order" })
                .Annotation("SqlServer:Clustered", true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "__Outbox_OutboxMessages");
        }
    }
}

﻿// <auto-generated />
using System;
using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NEvo.ExampleApp.Database;

#nullable disable

namespace NEvo.ExampleApp.Migrations
{
    [DbContext(typeof(ExampleDbContext))]
    [ExcludeFromCodeCoverage]
    partial class ExampleDbContextModelSnapshot : ModelSnapshot
    {
        protected override void BuildModel(ModelBuilder modelBuilder)
        {
#pragma warning disable 612, 618
            modelBuilder
                .HasAnnotation("ProductVersion", "8.0.3")
                .HasAnnotation("Relational:MaxIdentifierLength", 128);

            SqlServerModelBuilderExtensions.UseIdentityColumns(modelBuilder);

            modelBuilder.Entity("NEvo.Messaging.EntityFramework.Models.InboxProcessedHandler", b =>
                {
                    b.Property<Guid>("MessageId")
                        .HasColumnType("uniqueidentifier");

                    b.Property<string>("HandlerKey")
                        .HasColumnType("nvarchar(450)");

                    b.Property<DateTime>("ProcessedAt")
                        .HasColumnType("datetime2");

                    b.HasKey("MessageId", "HandlerKey");

                    SqlServerKeyBuilderExtensions.IsClustered(b.HasKey("MessageId", "HandlerKey"), false);

                    b.HasIndex("ProcessedAt");

                    SqlServerIndexBuilderExtensions.IsClustered(b.HasIndex("ProcessedAt"));

                    b.ToTable("InboxProcessedHandlers", "nEvo");
                });

            modelBuilder.Entity("NEvo.Messaging.EntityFramework.Models.InboxProcessedMessage", b =>
                {
                    b.Property<Guid>("MessageId")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("uniqueidentifier");

                    b.Property<DateTime>("ProcessedAt")
                        .HasColumnType("datetime2");

                    b.HasKey("MessageId");

                    SqlServerKeyBuilderExtensions.IsClustered(b.HasKey("MessageId"), false);

                    b.HasIndex("ProcessedAt");

                    SqlServerIndexBuilderExtensions.IsClustered(b.HasIndex("ProcessedAt"));

                    b.ToTable("InboxProcessedMessages", "nEvo");
                });

            modelBuilder.Entity("NEvo.Messaging.EntityFramework.Models.OutboxMessage", b =>
                {
                    b.Property<Guid>("MessageId")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("uniqueidentifier");

                    b.Property<string>("Headers")
                        .IsRequired()
                        .HasMaxLength(1024)
                        .HasColumnType("nvarchar(1024)");

                    b.Property<string>("MessageType")
                        .IsRequired()
                        .HasMaxLength(255)
                        .HasColumnType("nvarchar(255)");

                    b.Property<long>("Order")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("bigint");

                    SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<long>("Order"));

                    b.Property<int>("Partition")
                        .HasColumnType("int");

                    b.Property<string>("PartitionKey")
                        .HasMaxLength(255)
                        .HasColumnType("nvarchar(255)");

                    b.Property<string>("Payload")
                        .IsRequired()
                        .HasMaxLength(2147483647)
                        .HasColumnType("nvarchar(max)");

                    b.Property<int>("Status")
                        .HasColumnType("int");

                    b.HasKey("MessageId");

                    SqlServerKeyBuilderExtensions.IsClustered(b.HasKey("MessageId"), false);

                    b.HasIndex("Status", "Order");

                    b.HasIndex("Status", "Partition", "Order");

                    SqlServerIndexBuilderExtensions.IsClustered(b.HasIndex("Status", "Partition", "Order"));

                    b.ToTable("OutboxMessages", "nEvo");
                });
#pragma warning restore 612, 618
        }
    }
}

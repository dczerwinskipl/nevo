using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Attribues;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Property)]
public class PartitionKeyAttribute : Attribute
{
    public string? Type { get; set; }
}

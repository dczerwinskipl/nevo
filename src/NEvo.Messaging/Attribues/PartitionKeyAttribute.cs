namespace NEvo.Messaging.Attribues;

[AttributeUsage(AttributeTargets.Property)]
public class PartitionKeyAttribute : Attribute
{
    public string? Type { get; set; }
}

[AttributeUsage(AttributeTargets.Property)]
public class PartitionKeyTypeAttribute : Attribute
{
  
}

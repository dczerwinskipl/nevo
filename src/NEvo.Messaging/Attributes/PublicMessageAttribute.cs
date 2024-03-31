using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class PublicMessageAttribute : MessageVisibilityAttribute
{
    public override bool IsPrivate => false;
}
